import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export async function launchBrowser(isLambda = false) {
  const config = isLambda ? {
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--window-size=1240,1753', // Set explicit window size for Lambda
    ],
    defaultViewport: {
      width: 1240,
      height: 1753,
      deviceScaleFactor: 1,
    },
    executablePath: await chromium.executablePath(),
    headless: true,
    ignoreHTTPSErrors: true,
  } : {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1240,1753', // Set explicit window size for local too
    ],
    defaultViewport: {
      width: 1240,
      height: 1753,
      deviceScaleFactor: 1,
    },
    ignoreHTTPSErrors: true,
  };
  
  console.log('Launching browser...');
  const browser = await puppeteer.launch(config);
  console.log('Browser launched successfully');
  return browser;
}

export async function closeBrowser(browser) {
  if (browser) {
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed successfully');
  }
}