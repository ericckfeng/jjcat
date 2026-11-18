#!/usr/bin/env python3
"""把衛福部 TFDA「食品營養成分資料庫」xlsx 轉成 App 用的 tfda_foods.json。

用法：
    python3 scripts/build_foods.py <TFDA xlsx 檔> [--version 2025-UPDATE1] [--dry-run]

- 只用 Python 內建模組（不需安裝套件）。
- 會讀取現有的 tfda_foods.json 並列出差異（新增／刪除／數值變更）。
- TFDA 刪掉的品項不會從檔案移除，而是標記 removed，舊記錄、套餐還找得到。
- 數值一律是「每 100 g 可食部分」。
"""
import argparse
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tfda_foods.json'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'rel': 'http://schemas.openxmlformats.org/package/2006/relationships'}

# 欄位名稱 → 輸出鍵。用表頭名稱找欄位，TFDA 調整欄位順序也不影響。
# 只收營養標示上有的項目（自訂食物照包裝輸入，欄位一致合計才完整），見 docs/ROADMAP.md。
COLS = {
    'id': '整合編號', 'category': '食品分類', 'name': '樣品名稱', 'desc': '內容物描述', 'aliases': '俗名',
    'waste': '廢棄率(%)', 'kcal_raw': '熱量(kcal)', 'kcal_adj': '修正熱量(kcal)',
    'p': '粗蛋白(g)', 'f': '粗脂肪(g)', 'c': '總碳水化合物(g)', 'sugar': '糖質總量(g)',
    'na': '鈉(mg)',
}
REQUIRED = ['id', 'name', 'kcal_raw', 'p', 'f', 'c']
# 判斷「數值變了」的欄位
NUTR_KEYS = ['kcal', 'p', 'f', 'c', 'sugar', 'na']


def col_index(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path):
    """回傳第一個工作表的所有列（list of list，字串或數字）。"""
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
                shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        first = wb.find('m:sheets/m:sheet', NS)
        rid = first.get('{%s}id' % NS['r'])
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in rels.findall('rel:Relationship', NS) if r.get('Id') == rid)
        target = target.lstrip('/')
        sheet_path = target if target.startswith('xl/') else 'xl/' + target
        rows = []
        for row in ET.fromstring(z.read(sheet_path)).iter('{%s}row' % NS['m']):
            out = []
            for c in row.findall('m:c', NS):
                i = col_index(c.get('r'))
                while len(out) <= i:
                    out.append('')
                t = c.get('t')
                if t == 'inlineStr':
                    out[i] = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                    continue
                v = c.find('m:v', NS)
                if v is None or v.text is None:
                    continue
                if t == 's':
                    out[i] = shared[int(v.text)]
                elif t in ('str', 'b', 'e'):
                    out[i] = v.text
                else:
                    try:
                        out[i] = float(v.text)
                    except ValueError:
                        out[i] = v.text
            rows.append(out)
        return rows


def num(v, digits=1):
    if v is None or v == '':
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return round(x, digits) if digits else int(round(x))


def text(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''


def parse_state(desc):
    """「樣品狀態:生,雞胸部位; 前處理描述:...」→ ('raw', '生,雞胸部位')"""
    m = re.search(r'樣品狀態[:：]([^;；]*)', desc or '')
    note = m.group(1).strip() if m else ''
    first = re.split(r'[,，(（]', note)[0] if note else ''
    state = 'raw' if first == '生' else 'cooked' if first == '熟' else None
    return state, note


def split_aliases(v, name):
    out = []
    for a in re.split(r'[,，、;；/]', text(v)):
        a = a.strip()
        if a and a != name and a not in out:
            out.append(a)
    return out


def convert(rows):
    header_i = next((i for i, r in enumerate(rows[:10]) if '整合編號' in r), None)
    if header_i is None:
        sys.exit('找不到表頭（「整合編號」那一列），請確認是 TFDA 食品營養成分資料庫的 xlsx')
    header = [text(h) for h in rows[header_i]]
    idx = {}
    for key, label in COLS.items():
        if label in header:
            idx[key] = header.index(label)
        elif key in REQUIRED:
            sys.exit('xlsx 少了必要欄位「%s」，TFDA 可能改了欄位名稱，請更新 scripts/build_foods.py 的 COLS' % label)

    def get(r, key):
        i = idx.get(key)
        return r[i] if i is not None and i < len(r) else ''

    foods, seen, problems = [], set(), []
    for n, r in enumerate(rows[header_i + 1:], start=header_i + 2):
        fid = text(get(r, 'id'))
        name = text(get(r, 'name'))
        if not fid and not name:
            continue  # 空白列
        if not fid or not name:
            problems.append('第 %d 列缺編號或名稱，略過' % n)
            continue
        if fid in seen:
            problems.append('第 %d 列編號重複 %s，略過' % (n, fid))
            continue
        seen.add(fid)
        state, note = parse_state(text(get(r, 'desc')))
        kcal = num(get(r, 'kcal_adj'))
        if kcal is None:
            kcal = num(get(r, 'kcal_raw'))
        per = {'kcal': kcal, 'p': num(get(r, 'p')), 'f': num(get(r, 'f')), 'c': num(get(r, 'c')),
               'sugar': num(get(r, 'sugar')), 'na': num(get(r, 'na'), 0)}
        if per['kcal'] is None:
            problems.append('第 %d 列 %s %s 沒有熱量，略過' % (n, fid, name))
            continue
        food = {'id': fid, 'name': name}
        aliases = split_aliases(get(r, 'aliases'), name)
        if aliases:
            food['aliases'] = aliases
        food['category'] = text(get(r, 'category'))
        if state:
            food['state'] = state
        if note:
            food['note'] = note
        waste = num(get(r, 'waste'))
        if waste:
            food['waste'] = waste
        food['per100g'] = {k: v for k, v in per.items() if v is not None}
        foods.append(food)
    return foods, problems


def diff(old_foods, new_foods):
    old = {f['id']: f for f in old_foods if not f.get('removed')}
    new = {f['id']: f for f in new_foods}
    added = [new[i] for i in new if i not in old]
    removed = [old[i] for i in old if i not in new]
    changed = []
    for i in new:
        if i not in old:
            continue
        a, b = old[i], new[i]
        parts = []
        if a['name'] != b['name']:
            parts.append('名稱 %s→%s' % (a['name'], b['name']))
        for k in NUTR_KEYS:
            va, vb = a['per100g'].get(k), b['per100g'].get(k)
            if va != vb:
                parts.append('%s %s→%s' % (k, va, vb))
        if parts:
            changed.append((b, parts))
    return added, removed, changed


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('xlsx')
    ap.add_argument('--version', help='資料版本，例如 2025-UPDATE1（預設從檔名猜）')
    ap.add_argument('--dry-run', action='store_true', help='只列出差異，不寫檔')
    args = ap.parse_args()

    src = Path(args.xlsx)
    raw = src.read_bytes()
    foods, problems = convert(read_xlsx(src))
    version = args.version
    if not version:
        m = re.search(r'(\d{4})版?\s*(UPDATE\s*\d+)?', src.name, re.I)
        version = (m.group(1) + ('-' + m.group(2).replace(' ', '').upper() if m.group(2) else '')) if m else date.today().isoformat()

    old = json.loads(OUT.read_text('utf-8')) if OUT.exists() else {'foods': []}
    added, removed, changed = diff(old.get('foods', []), foods)

    # TFDA 刪掉的品項：保留並標記，舊記錄、套餐還找得到
    keep = {f['id'] for f in foods}
    for f in old.get('foods', []):
        if f['id'] in keep:
            continue
        g = dict(f)
        if not g.get('removed'):
            g['removed'] = version
        foods.append(g)

    print('版本 %s：%d 筆（另有 %d 筆已被 TFDA 刪除、保留供舊記錄使用）' % (
        version, len(keep), len(foods) - len(keep)))
    print('與上一版（%s）比較：新增 %d、刪除 %d、數值變更 %d' % (
        (old.get('source') or {}).get('version', '無'), len(added), len(removed), len(changed)))
    for f in added[:30]:
        print('  + %s %s' % (f['id'], f['name']))
    if len(added) > 30:
        print('  …另 %d 筆新增' % (len(added) - 30))
    for f in removed:
        print('  - %s %s' % (f['id'], f['name']))
    for f, parts in changed[:50]:
        print('  ~ %s %s：%s' % (f['id'], f['name'], '、'.join(parts)))
    if len(changed) > 50:
        print('  …另 %d 筆變更' % (len(changed) - 50))
    for p in problems:
        print('  ! ' + p)

    if args.dry_run:
        print('（--dry-run，沒有寫檔）')
        return
    out = {
        'source': {
            'name': '衛生福利部食品藥物管理署 食品營養成分資料庫',
            'version': version,
            'file': src.name,
            'sha256': hashlib.sha256(raw).hexdigest(),
            'builtAt': date.today().isoformat(),
            'note': '數值為每 100 g 可食部分。kcal 取「修正熱量」（沒有時用「熱量」）；c 為總碳水化合物（和營養標示一樣含膳食纖維）；na 單位 mg。只收營養標示上有的項目。',
        },
        'foods': foods,
    }
    # 一筆一行：檔案小、git diff 也看得出哪一筆改了
    lines = ['{', ' "source": ' + json.dumps(out['source'], ensure_ascii=False) + ',', ' "foods": [']
    lines += ['  ' + json.dumps(f, ensure_ascii=False, separators=(',', ':')) + (',' if i < len(foods) - 1 else '')
              for i, f in enumerate(foods)]
    lines += [' ]', '}']
    OUT.write_text('\n'.join(lines) + '\n', 'utf-8')
    print('已寫入 %s（%d KB）' % (OUT.relative_to(ROOT), OUT.stat().st_size // 1024))


if __name__ == '__main__':
    main()
