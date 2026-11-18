// e2e 測試：用本機靜態伺服器開 App，CDN 一律換成離線替身，結果不受網路影響
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    // 沒有用 npx playwright install 的環境，可用 CHROME_PATH 指定瀏覽器
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'ignore'
  }
});
