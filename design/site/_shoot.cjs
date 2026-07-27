// Headless screenshot of the landing page (light + dark variants)
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const file = 'file:///' + path.resolve('D:/开发/tokengirl/design/site/index.html').replace(/\\/g, '/');

  for (const [theme, out] of [['dark', 'preview-dark.png'], ['light', 'preview-light.png']]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
    });
    const page = await context.newPage();
    await page.addInitScript(`localStorage.setItem('moonmeter-theme','${theme}');`);
    await page.goto(file, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'D:/开发/tokengirl/design/site/' + out, fullPage: true });
    console.log('OK', out);
    await context.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
