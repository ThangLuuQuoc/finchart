/**
 * Screenshot script for the Pine transpiler demo.
 * Takes screenshots of Volume Profile and VSA running on 50k candles.
 */
import { chromium } from 'playwright-core';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  console.log('Opening demo page...');
  await page.goto('http://localhost:5185/', { waitUntil: 'networkidle', timeout: 30000 });
  
  // Wait for the chart to render and pipeline to complete
  console.log('Waiting for pipeline to complete...');
  try {
    await page.waitForFunction(() => document.title === 'PINE-DEMO-DONE', { timeout: 30000 });
  } catch (e) {
    console.log('Timeout waiting for completion, taking screenshot anyway...');
  }
  
  // Wait extra for chart rendering
  await page.waitForTimeout(2000);
  
  // Full page screenshot
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outDir = 'd:/2026/Temp/FinChart';
  
  await page.screenshot({ 
    path: `${outDir}/pine-transpiler-vp-vsa-${ts}.png`,
    fullPage: false
  });
  console.log(`Screenshot saved: pine-transpiler-vp-vsa-${ts}.png`);
  
  // Check for errors in console
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  // Get the status text
  const statusText = await page.$eval('#status-text', el => el.textContent);
  console.log(`Status: ${statusText}`);
  
  // Get metrics
  const metrics = await page.$$eval('.metric-row', rows => 
    rows.map(r => ({
      label: r.querySelector('.metric-label')?.textContent,
      value: r.querySelector('.metric-value')?.textContent,
    }))
  );
  console.log('Metrics:');
  for (const m of metrics) {
    console.log(`  ${m.label}: ${m.value}`);
  }
  
  await browser.close();
  console.log('Done!');
}

main().catch(e => {
  console.error('Screenshot failed:', e.message);
  process.exit(1);
});
