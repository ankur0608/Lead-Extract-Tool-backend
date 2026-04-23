const puppeteer = require('puppeteer-core');

const isProd =
  process.env.NODE_ENV === 'production' ||
  process.platform === 'linux';

async function launchBrowser() {
  if (isProd) {
    const chromium = require('@sparticuz/chromium');
    return puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });
  }

  const localPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  return puppeteer.launch({
    executablePath: localPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
}

module.exports = { launchBrowser };
