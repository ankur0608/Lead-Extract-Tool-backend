const puppeteer = require('puppeteer-core');

// Fast auto-scroll
async function autoScroll(page, limit) {
    await page.evaluate(async (targetLimit) => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 400;
            let currentCount = 0;
            let noChangeRepeats = 0;
            const timer = setInterval(() => {
                const scrollableSection = document.querySelector('div[role="feed"]');
                if (scrollableSection) {
                    scrollableSection.scrollBy(0, distance);
                    totalHeight += distance;

                    const newCount = document.querySelectorAll('a[href*="/place/"]').length;
                    if (newCount === currentCount) noChangeRepeats++;
                    else noChangeRepeats = 0;
                    currentCount = newCount;

                    if (currentCount >= targetLimit || noChangeRepeats > 15 || totalHeight >= 60000) {
                        clearInterval(timer);
                        resolve();
                    }
                } else {
                    clearInterval(timer);
                    resolve();
                }
            }, 300);
        });
    }, limit);
}

// Very fast heuristic email scraper
async function extractEmail(browser, websiteUrl) {
    if (!websiteUrl || !websiteUrl.startsWith('http')) return '';
    try {
        const page = await browser.newPage();
        
        // Intercept and block unnecessary resources to drastically speed up page load
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Navigate fast, don't wait for all network idle
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        
        // Check for mailto links or regex in body
        const email = await page.evaluate(() => {
            // Check mailto anchors
            const mailto = document.querySelector('a[href^="mailto:"]');
            if (mailto) return mailto.href.replace('mailto:', '').split('?')[0].trim();
            
            // Regex over visible text
            const text = document.body.innerText;
            const match = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
            if (match && match.length > 0) {
                // Return first valid looking email that isn't a common image extension or wix blank
                return match.find(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.includes('sentry')) || '';
            }
            return '';
        });
        
        await page.close();
        return email || '';
    } catch (err) {
        return ''; // ignore errors on dead sites
    }
}

async function extractLeads(category, location, limit = 10, onProgress = null) {
    const query = encodeURIComponent(`${category} in ${location}`);
    const url = `https://www.google.com/maps/search/${query}`;
    
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    const leads = [];

    try {
        // Send initial progress
        if (onProgress) onProgress({ status: 'navigating', message: 'Accessing Google Maps...' });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        try {
            await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
        } catch (e) {
            await browser.close();
            if (onProgress) onProgress({ status: 'error', message: 'Could not find the results feed.' });
            return leads;
        }

        if (onProgress) onProgress({ status: 'scrolling', message: 'Scrolling to gather local businesses...' });
        await autoScroll(page, limit);
        
        await new Promise(r => setTimeout(r, 1000));

        const links = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/place/"]'));
            return anchors.map(a => a.href).filter((v, i, a) => a.indexOf(v) === i); 
        });

        const maxLimit = Math.min(links.length, limit);
        
        if (onProgress) onProgress({ status: 'extracting', total: maxLimit, current: 0, message: 'Diving into profiles...' });

        for (let i = 0; i < maxLimit; i++) {
            try {
                await page.goto(links[i], { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(r => setTimeout(r, 1000));

                let businessDetails = await page.evaluate((category, link) => {
                    const getText = (selector) => { const el = document.querySelector(selector); return el ? el.innerText.trim() : ''; };
                    const getByAriaLabel = (prefix) => { const el = document.querySelector(`[aria-label^="${prefix}"]`); return el ? el.getAttribute('aria-label').replace(prefix, '').trim() : ''; };
                    const getByDataItemId = (id) => { const el = document.querySelector(`[data-item-id="${id}"]`); return el ? el.innerText.trim() : ''; };

                    const name = getText('h1') || 'Unknown';
                    const ratingStr = getByAriaLabel('stars'); 
                    let rating = '', reviews = '';
                    if (ratingStr && ratingStr.includes('stars')) {
                        const parts = ratingStr.split('stars');
                        rating = parts[0].trim();
                        if (parts.length > 1) reviews = parts[1].replace(/[^0-9]/g, '');
                    }

                    const address = getByAriaLabel('Address: ') || getByAriaLabel('Destination ') || getText('button[data-item-id="address"]');
                    const phone = getByAriaLabel('Phone: ') || getText('button[data-item-id^="phone:tel:"]');
                    let website = getByAriaLabel('Website: ') || getText('a[data-item-id="authority"]');
                    if (website && !website.startsWith('http')) website = 'https://' + website;

                    return { name, phone, website, address, maps_url: link, rating, reviews, category, email: '' };
                }, category, links[i]);

                if (businessDetails.name !== 'Unknown') {
                    // Deep enrichment for email
                    if (businessDetails.website) {
                        businessDetails.email = await extractEmail(browser, businessDetails.website);
                    }

                    leads.push(businessDetails);
                    
                    // Stream this lead back immediately
                    if (onProgress) onProgress({ 
                        status: 'lead_found', 
                        total: maxLimit, 
                        current: i + 1, 
                        lead: businessDetails 
                    });
                } else {
                     if (onProgress) onProgress({ status: 'lead_failed', total: maxLimit, current: i + 1 });
                }

            } catch (err) {
                if (onProgress) onProgress({ status: 'lead_failed', total: maxLimit, current: i + 1 });
                continue;
            }
        }
    } catch (error) {
        console.error('Puppeteer Maps Extraction Error:', error.message);
    } finally {
        await browser.close();
        if (onProgress) onProgress({ status: 'done', message: 'Extraction complete' });
    }

    return leads;
}

module.exports = {
  extractLeads
};
