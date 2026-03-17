const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
    console.log(`PAGE LOG: ${text}`);
  });

  page.on('pageerror', err => {
    consoleLogs.push(`[PAGE ERROR] ${err.toString()}`);
    console.error(`PAGE ERROR: ${err.toString()}`);
  });

  try {
    console.log('Visiting http://127.0.0.1:8000/app ...');
    await page.goto('http://127.0.0.1:8000/app', { waitUntil: 'networkidle' });
    
    // Wait a bit for React/Babel to do their thing
    await page.waitForTimeout(5000);

    // Take a screenshot
    const screenshotPath = path.join(__dirname, 'debug_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    // Inspect the DOM and state
    const debugInfo = await page.evaluate(() => {
      const root = document.getElementById('root');
      const rootHtml = root ? root.innerHTML : 'ROOT NOT FOUND';
      const threeDefined = typeof window.THREE !== 'undefined';
      const reactDefined = typeof window.React !== 'undefined';
      
      return {
        rootHtml: rootHtml.substring(0, 500), // first 500 chars
        threeDefined,
        reactDefined,
        bodyHeight: document.body.scrollHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight
      };
    });
    console.log('Debug Info:', JSON.stringify(debugInfo, null, 2));

  } catch (err) {
    console.error('Playwright Error:', err);
  } finally {
    await browser.close();
  }
})();
