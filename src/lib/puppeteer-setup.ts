import puppeteer from 'puppeteer-core';
import { addExtra, VanillaPuppeteer } from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

// Wii user-agent gives awesome twitter output :)
// standard or slurp gives old style twitter 'modal' view
export const userAgents = {
  wii: 'Opera/9.30 (Nintendo Wii; U; ; 2071; Wii Shop Channel/1.0; en)',
  standard: 'Mozilla/5.0 (compatible)',
  slurp: 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'
};

export async function getPage(ua: keyof typeof userAgents = 'standard'): Promise<any> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setUserAgent(userAgents[ua]);

  page.setViewport({ width: 800, height: 1680 });
  page.on('error', function (err) {
    err.message = `[BROWSER] ${err.message}`;
    console.error(err);
  });
  return page;
}

export async function getBrowser() {
  const ePup = addExtra(puppeteer as any as VanillaPuppeteer);

  ePup.use(Stealth());
  ePup.use(AdblockerPlugin());

  const browser = await ePup.connect({
    browserWSEndpoint:
      'ws://localhost:3000' +
      '?--window-size=1920x1080' +
      '&ignoreDefaultArgs=--enable-automation' +
      '&headless=true' +
      // `&--proxy-server=http://${proxy}` +
      //'&--no-sandbox=true' +
      //'&--disable-setuid-sandbox=true' +
      //'&--disable-dev-shm-usage=true' +
      //'&--disable-accelerated-2d-canvas=true' +
      //'&--disable-gpu=true' +
      //'&--headless=false' +
      '&--load-extension=/usr/src/app/extensions/cookies_extension' +
      '&--disable-extensions-except=/usr/src/app/extensions/cookies_extension'
  });

  return browser;
}

export async function navigatePageSimple(page: puppeteer.Page, url: string, { waitFor = 10000 }) {
  const response = await page.goto(url, {
    timeout: 40000,
    waitUntil: 'networkidle2'
  }).catch(_ => { console.log(`navigation to ${url} timed out`) })
  if (response && response.status() < 400) {
    await page.waitForTimeout(waitFor);
    return response;
  }
  return response;
}

/**
 * Scrolling page to bottom based on Body element
 * @param {Object} page Puppeteer page object
 * @param {Number} scrollStep Number of pixels to scroll on each step
 * @param {Number} scrollDelay A delay between each scroll step
 * @returns {Number} Last scroll position
 */
export async function scrollPageToBottom(page: puppeteer.Page, scrollStep = 200, scrollDelay = 1200, maxScroll = 5000) {
  const lastPosition = await page.evaluate(
    async (step, delay) => {
      const getScrollHeight = (element: any) => {
        const { scrollHeight, offsetHeight, clientHeight } = element;
        return Math.max(scrollHeight, offsetHeight, clientHeight);
      };

      const position = await new Promise(resolve => {
        let count = 0;
        const intervalId = setInterval(() => {
          const { body } = document;
          const availableScrollHeight = getScrollHeight(body);

          window.scrollBy(0, step);
          count += step;

          if (count >= availableScrollHeight || count >= maxScroll) {
            clearInterval(intervalId);
            resolve(count);
          }
        }, delay);
      });

      return position;
    },
    scrollStep,
    scrollDelay
  );
  return lastPosition;
}
