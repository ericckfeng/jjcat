#!/usr/bin/env python3
"""發佈前跑一次：版本號加 1。

版本＝「發佈日期-當天第幾次（Rev. 第幾次發佈）」，例如 2026.11.20-1（Rev. 39）。
日期用台灣時間。會一起改：
  js/version.js   APP_REV、APP_DATE、APP_SEQ
  version.json    網站上「目前最新版」（App 打開時會讀它，比自己新就提示更新）
  sw.js           快取名稱 diet-tracker-v<Rev>
  index.html      js/app.js?v=<Rev>、css/app.css?v=<Rev>

用法：python3 scripts/bump.py          （--dry-run 只顯示會改成什麼）
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TW = timezone(timedelta(hours=8))


def sub_once(text, pattern, repl, name):
    new, n = re.subn(pattern, repl, text)
    if n == 0:
        sys.exit(f'{name} 找不到要改的地方：{pattern}')
    return new


def main():
    dry = '--dry-run' in sys.argv
    vpath = ROOT / 'js' / 'version.js'
    vjs = vpath.read_text(encoding='utf-8')
    rev = int(re.search(r'export const APP_REV = (\d+);', vjs).group(1))
    date = re.search(r"export const APP_DATE = '([^']*)';", vjs).group(1)
    seq = int(re.search(r'export const APP_SEQ = (\d+);', vjs).group(1))

    today = datetime.now(TW).strftime('%Y.%m.%d')
    new_rev = rev + 1
    new_seq = seq + 1 if date == today else 1
    ver = f'{today}-{new_seq}'
    print(f'{date + "-" + str(seq) if date else "（舊編法）"}（Rev. {rev}） → {ver}（Rev. {new_rev}）')
    if dry:
        return

    vjs = sub_once(vjs, r'export const APP_REV = \d+;', f'export const APP_REV = {new_rev};', 'js/version.js')
    vjs = sub_once(vjs, r"export const APP_DATE = '[^']*';", f"export const APP_DATE = '{today}';", 'js/version.js')
    vjs = sub_once(vjs, r'export const APP_SEQ = \d+;', f'export const APP_SEQ = {new_seq};', 'js/version.js')
    vpath.write_text(vjs, encoding='utf-8')

    (ROOT / 'version.json').write_text(json.dumps({'rev': new_rev, 'ver': ver}) + '\n', encoding='utf-8')

    sw = ROOT / 'sw.js'
    sw.write_text(sub_once(sw.read_text(encoding='utf-8'), r"diet-tracker-v\d+", f'diet-tracker-v{new_rev}', 'sw.js'), encoding='utf-8')

    idx = ROOT / 'index.html'
    html = idx.read_text(encoding='utf-8')
    html = sub_once(html, r'js/app\.js\?v=\d+', f'js/app.js?v={new_rev}', 'index.html')
    html = sub_once(html, r'css/app\.css\?v=\d+', f'css/app.css?v={new_rev}', 'index.html')
    idx.write_text(html, encoding='utf-8')
    print('已更新 js/version.js、version.json、sw.js、index.html')


if __name__ == '__main__':
    main()
