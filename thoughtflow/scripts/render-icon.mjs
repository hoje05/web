// build/icon.svg → build/icon.png (512x512). 아이콘을 바꿀 때만 실행.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const svg = readFileSync('build/icon.svg', 'utf-8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
console.log('build/icon.png written');
