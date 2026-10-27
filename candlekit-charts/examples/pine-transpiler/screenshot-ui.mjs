import { chromium } from 'playwright-core';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('http://localhost:5185/');
  
  // Wait for editor and chart to load
  await page.waitForTimeout(2000);
  
  // Click Transpile & Run
  await page.click('#btn-run');
  
  // Wait for compilation and chart update
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'd:/2026/Temp/FinChart/ui-transpiler-run.png' });
  await browser.close();
  console.log("Screenshot taken.");
})();
