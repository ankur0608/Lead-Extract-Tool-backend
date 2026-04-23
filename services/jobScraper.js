const puppeteer = require('puppeteer-core');

// ─── CONFIGURATION ────────────────────────────────────────────────────
const CAREER_PATHS = [
  '/careers', '/jobs', '/career', '/join-us', '/work-with-us', '/opportunities',
  '/hiring', '/job-openings', '/vacancies', '/employment', '/join', '/work',
  '/about/careers', '/company/careers', '/open-positions', '/current-openings',
  '/life-at', '/team'
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── GOOGLE MAPS COMPANY SEARCH ───────────────────────────────────────
async function searchCompaniesOnMaps(browser, page, location, keyword, limit, onProgress) {
  const queryTerm = keyword ? `${keyword} companies` : 'companies';
  const query = encodeURIComponent(`${queryTerm} in ${location}`);
  const url = `https://www.google.com/maps/search/${query}`;

  if (onProgress) onProgress({ status: 'navigating', message: `Searching Google Maps for companies in ${location}...` });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for the results feed
  try {
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
  } catch (e) {
    if (onProgress) onProgress({ status: 'warning', message: 'No results feed found, trying alternate approach...' });
    return [];
  }

  // Scroll to load results
  if (onProgress) onProgress({ status: 'scrolling', message: 'Gathering local companies...' });

  await page.evaluate(async (maxLimit) => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      let noChangeRepeats = 0;
      let currentCount = 0;
      const timer = setInterval(() => {
        const scrollableSection = document.querySelector('div[role="feed"]');
        if (scrollableSection) {
          scrollableSection.scrollBy(0, distance);
          totalHeight += distance;
          const newCount = document.querySelectorAll('a[href*="/place/"]').length;
          if (newCount === currentCount) noChangeRepeats++;
          else noChangeRepeats = 0;
          currentCount = newCount;
          if (currentCount >= maxLimit || noChangeRepeats > 12 || totalHeight >= 50000) {
            clearInterval(timer);
            resolve();
          }
        } else {
          clearInterval(timer);
          resolve();
        }
      }, 350);
    });
  }, limit);

  await delay(1000);

  // Extract place links
  const placeLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/place/"]'));
    return anchors.map(a => a.href).filter((v, i, a) => a.indexOf(v) === i);
  });

  const companies = [];
  const maxCompanies = Math.min(placeLinks.length, limit);

  if (onProgress) onProgress({ status: 'extracting', message: `Found ${placeLinks.length} companies. Extracting details from top ${maxCompanies}...`, total: maxCompanies, current: 0 });

  for (let i = 0; i < maxCompanies; i++) {
    try {
      await page.goto(placeLinks[i], { waitUntil: 'domcontentloaded', timeout: 25000 });
      await delay(1200);

      const details = await page.evaluate((link) => {
        const getText = (sel) => { const el = document.querySelector(sel); return el ? el.innerText.trim() : ''; };
        const getByAriaLabel = (prefix) => { const el = document.querySelector(`[aria-label^="${prefix}"]`); return el ? el.getAttribute('aria-label').replace(prefix, '').trim() : ''; };

        const name = getText('h1') || getText('h2') || document.title.split('-')[0].split('–')[0].replace('Google Maps', '').trim() || 'Unknown';
        const address = getByAriaLabel('Address: ') || getByAriaLabel('Destination ') || '';
        let website = getByAriaLabel('Website: ') || getText('a[data-item-id="authority"]');
        const phone = getByAriaLabel('Phone: ') || getText('button[data-item-id^="phone:tel:"]');
        if (website && !website.startsWith('http')) website = 'https://' + website;

        return { name, address, website, mapsUrl: link, phone };
      }, placeLinks[i]);

      if (details.name !== 'Unknown' && details.website) {
        
        // Quick extraction for email on their website homepage
        let email = '';
        try {
           const tempPage = await browser.newPage();
           await tempPage.setRequestInterception(true);
           tempPage.on('request', (req) => {
             if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
             else req.continue();
           });
           await tempPage.goto(details.website, { waitUntil: 'domcontentloaded', timeout: 8000 });
           email = await tempPage.evaluate(() => {
             const mailto = document.querySelector('a[href^="mailto:"]');
             if (mailto) return mailto.href.replace('mailto:', '').split('?')[0].trim();
             const match = document.body.innerText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
             if (match && match.length > 0) return match.find(e => !e.endsWith('.png') && !e.endsWith('.jpg')) || '';
             return '';
           });
           await tempPage.close();
        } catch(e) {}
        details.email = email;

        companies.push(details);
        if (onProgress) onProgress({
          status: 'company_found',
          message: `Found: ${details.name}`,
          company: details,
          total: maxCompanies,
          current: i + 1
        });
      } else {
        if (onProgress) onProgress({ status: 'company_skip', message: `Skipped (no website): ${details.name}`, total: maxCompanies, current: i + 1 });
      }
    } catch (err) {
      if (onProgress) onProgress({ status: 'company_skip', message: `Failed to extract company #${i + 1}`, total: maxCompanies, current: i + 1 });
      continue;
    }
  }

  return companies;
}

// ─── FIND CAREER PAGE ─────────────────────────────────────────────────
async function findCareerPage(browser, websiteUrl, onProgress) {
  if (!websiteUrl || !websiteUrl.startsWith('http')) return null;

  const careerPage = await browser.newPage();
  await careerPage.setUserAgent(getRandomUA());

  // Block heavy resources
  await careerPage.setRequestInterception(true);
  careerPage.on('request', (req) => {
    if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    // First: try common career paths
    const baseUrl = new URL(websiteUrl).origin;

    for (const path of CAREER_PATHS) {
      try {
        const testUrl = baseUrl + path;
        const resp = await careerPage.goto(testUrl, { waitUntil: 'networkidle2', timeout: 10000 });
        if (resp && (resp.status() >= 200 && resp.status() < 300 || resp.status() === 304)) {
          await new Promise(r => setTimeout(r, 1000)); // allow JS to render
          const bodyText = await careerPage.evaluate(() => document.body?.innerText?.toLowerCase() || '');
          // Verify it's actually a career page
          const careerKeywords = ['job', 'career', 'position', 'hiring', 'apply', 'vacancy', 'opening', 'opportunity', 'role', 'resume'];
          const matchCount = careerKeywords.filter(kw => bodyText.includes(kw)).length;
          if (matchCount >= 1) {
            await careerPage.close();
            return testUrl;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Second: scan homepage for career links
    try {
      await careerPage.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 1500)); // wait for full render
      const careerLink = await careerPage.evaluate(() => {
        const keywords = ['career', 'job', 'hiring', 'join', 'work with us', 'opportunities', 'employment', 'open positions', 'current openings'];
        const links = Array.from(document.querySelectorAll('a'));
        
        // Find all matching links
        let bestLink = null;
        for (const link of links) {
          const text = (link.textContent || '').toLowerCase().trim();
          const href = (link.href || '').toLowerCase();
          
          if (!href || href.includes('javascript:') || href.endsWith('#') || href.includes('mailto:')) continue;
          
          if (keywords.some(kw => text.includes(kw) || href.includes(kw))) {
            bestLink = link.href;
            if (href.includes('career') || href.includes('job')) break; // Prefer direct career URLs
          }
        }
        return bestLink;
      });
      await careerPage.close();
      return careerLink;
    } catch (e) {
      await careerPage.close();
      return null;
    }
  } catch (err) {
    try { await careerPage.close(); } catch(e) {}
    return null;
  }
}

// ─── SCRAPE JOBS FROM CAREER PAGE ─────────────────────────────────────
async function scrapeJobsFromPage(browser, careerUrl, companyObj) {
  if (!careerUrl) return [];

  const jobPage = await browser.newPage();
  await jobPage.setUserAgent(getRandomUA());

  // Block heavy resources
  await jobPage.setRequestInterception(true);
  jobPage.on('request', (req) => {
    if (['image', 'font', 'media'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    await jobPage.goto(careerUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(1500);

    const jobs = await jobPage.evaluate((companyObj, source) => {
      const results = [];

      // Strategy 1: Look for structured job listing elements
      const jobSelectors = [
        // Common job listing patterns
        '.job-listing', '.job-card', '.job-item', '.position-item', '.career-item',
        '.job-opening', '.job-post', '.career-listing', '.vacancy-item',
        '[class*="job-"]', '[class*="career-"]', '[class*="position-"]', '[class*="opening-"]',
        'article', '.posting', '.opportunity',
        // List items with links
        'li a[href*="job"]', 'li a[href*="career"]', 'li a[href*="position"]',
        'li a[href*="apply"]', 'li a[href*="opening"]',
      ];

      for (const selector of jobSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0 && elements.length < 100) {
            elements.forEach(el => {
              const titleEl = el.querySelector('h2, h3, h4, .title, [class*="title"], a, strong');
              const title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().substring(0, 100);
              const link = el.querySelector('a')?.href || el.closest('a')?.href || source;
              const descEl = el.querySelector('p, .description, [class*="desc"], [class*="summary"], li');
              const fullText = el.textContent || '';
              const desc = descEl ? descEl.textContent.trim() : '';
              const locEl = el.querySelector('[class*="location"], [class*="loc"]');
              const loc = locEl ? locEl.textContent.trim() : address;
              
              // Extract experience, salary, and employment type
              const expMatch = fullText.match(/(\d+\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience)/i);
              const expLevel = fullText.match(/(Junior|Senior|Lead|Principal|Entry[-\s]Level|Mid[-\s]Level)/i);
              const experience = expMatch ? expMatch[0] : (expLevel ? expLevel[0] : '');
              
              const salaryMatch = fullText.match(/(\$\d{2,3}[kK](?:\s*-\s*\$\d{2,3}[kK])?|\$\d{2,3},\d{3}(?:\s*-\s*\$\d{2,3},\d{3})?|\$\d{2,3}(?:\.\d{2})?\s*\/\s*(?:hr|hour|hour|h))/i);
              const salary = salaryMatch ? salaryMatch[0] : '';
              
              const empTypeMatch = fullText.match(/(Full[- ]Time|Part[- ]Time|Contract|Freelance|Internship|Temporary)/i);
              const empType = empTypeMatch ? empTypeMatch[0] : '';

              if (title && title.length > 3 && title.length < 200) {
                
                // Determine remote vs onsite
                let type = 'Onsite';
                if (fullText.toLowerCase().includes('remote') || loc.toLowerCase().includes('remote')) type = 'Remote';
                else if (fullText.toLowerCase().includes('hybrid') || loc.toLowerCase().includes('hybrid')) type = 'Hybrid';

                results.push({
                  company: companyObj.name,
                  title: title.replace(/\n/g, ' ').trim(),
                  location: loc || companyObj.address || '',
                  address: companyObj.address || '',
                  phone: companyObj.phone || '',
                  email: companyObj.email || '',
                  website: companyObj.website || '',
                  applyLink: link || source,
                  description: desc || fullText.substring(0, 300),
                  experience: experience,
                  salary: salary,
                  empType: empType || 'Full-Time',
                  type: type,
                  source
                });
              }
            });
            if (results.length > 0) break;
          }
        } catch(e) { continue; }
      }

      // Strategy 2: If no structured results, look for heading + link combos
      if (results.length === 0) {
        const headings = document.querySelectorAll('h2, h3, h4');
        headings.forEach(h => {
          const text = h.textContent.trim();
          const parent = h.parentElement;
          const link = parent?.querySelector('a')?.href || h.closest('a')?.href || '';
          const jobKeywords = ['engineer', 'developer', 'manager', 'analyst', 'designer', 'specialist',
            'coordinator', 'director', 'associate', 'intern', 'lead', 'senior', 'junior',
            'consultant', 'architect', 'administrator', 'support', 'sales', 'marketing',
            'assistant', 'executive', 'representative', 'technician', 'officer'];

          if (text.length > 4 && text.length < 150 && jobKeywords.some(kw => text.toLowerCase().includes(kw))) {
            const nextP = h.nextElementSibling;
            const fullText = (parent ? parent.textContent : '') || '';
            const desc = nextP?.tagName === 'P' ? nextP.textContent.trim().substring(0, 300) : '';
            
            const expMatch = fullText.match(/(\d+\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience)/i);
            const expLevel = fullText.match(/(Junior|Senior|Lead|Principal|Entry[-\s]Level|Mid[-\s]Level)/i);
            const experience = expMatch ? expMatch[0] : (expLevel ? expLevel[0] : '');
            
            const salaryMatch = fullText.match(/(\$\d{2,3}[kK](?:\s*-\s*\$\d{2,3}[kK])?|\$\d{2,3},\d{3}(?:\s*-\s*\$\d{2,3},\d{3})?|\$\d{2,3}(?:\.\d{2})?\s*\/\s*(?:hr|hour|hour|h))/i);
            const salary = salaryMatch ? salaryMatch[0] : '';
            
            const empTypeMatch = fullText.match(/(Full[- ]Time|Part[- ]Time|Contract|Freelance|Internship|Temporary)/i);
            const empType = empTypeMatch ? empTypeMatch[0] : '';

            let type = 'Onsite';
            if (fullText.toLowerCase().includes('remote') || (companyObj.address||'').toLowerCase().includes('remote')) type = 'Remote';
            else if (fullText.toLowerCase().includes('hybrid') || (companyObj.address||'').toLowerCase().includes('hybrid')) type = 'Hybrid';

            results.push({
              company: companyObj.name,
              title: text.replace(/\n/g, ' ').trim(),
              location: companyObj.address || '',
              address: companyObj.address || '',
              phone: companyObj.phone || '',
              email: companyObj.email || '',
              website: companyObj.website || '',
              applyLink: link || source,
              description: desc,
              experience: experience,
              salary: salary,
              empType: empType || 'Full-Time',
              type: type,
              source
            });
          }
        });
      }

      // Strategy 3: Look for links with job-related text
      if (results.length === 0) {
        const links = document.querySelectorAll('a');
        const seen = new Set();
        links.forEach(a => {
          const text = a.textContent.trim();
          const href = a.href || '';
          const jobWords = ['apply', 'position', 'opening', 'role', 'engineer', 'developer',
            'manager', 'designer', 'analyst', 'specialist', 'intern'];
          if (text.length > 5 && text.length < 150 && !seen.has(text) &&
              (jobWords.some(w => text.toLowerCase().includes(w)) ||
               jobWords.some(w => href.toLowerCase().includes(w)))) {
            seen.add(text);
            const fullText = a.parentElement ? a.parentElement.textContent : text;
            const expMatch = fullText.match(/(\d+\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience)/i);
            const expLevel = fullText.match(/(Junior|Senior|Lead|Principal|Entry[-\s]Level|Mid[-\s]Level)/i);
            const experience = expMatch ? expMatch[0] : (expLevel ? expLevel[0] : '');
            
            const salaryMatch = fullText.match(/(\$\d{2,3}[kK](?:\s*-\s*\$\d{2,3}[kK])?|\$\d{2,3},\d{3}(?:\s*-\s*\$\d{2,3},\d{3})?|\$\d{2,3}(?:\.\d{2})?\s*\/\s*(?:hr|hour|hour|h))/i);
            const salary = salaryMatch ? salaryMatch[0] : '';
            
            const empTypeMatch = fullText.match(/(Full[- ]Time|Part[- ]Time|Contract|Freelance|Internship|Temporary)/i);
            const empType = empTypeMatch ? empTypeMatch[0] : '';

            let type = 'Onsite';
            if (fullText.toLowerCase().includes('remote') || (companyObj.address||'').toLowerCase().includes('remote')) type = 'Remote';
            else if (fullText.toLowerCase().includes('hybrid') || (companyObj.address||'').toLowerCase().includes('hybrid')) type = 'Hybrid';

            results.push({
              company: companyObj.name,
              title: text.replace(/\n/g, ' ').trim(),
              location: companyObj.address || '',
              address: companyObj.address || '',
              phone: companyObj.phone || '',
              email: companyObj.email || '',
              website: companyObj.website || '',
              applyLink: href || source,
              description: '',
              experience: experience,
              salary: salary,
              empType: empType || 'Full-Time',
              type: type,
              source
            });
          }
        });
      }

      return results;
    }, companyObj, careerUrl);

    await jobPage.close();
    return jobs;
  } catch (err) {
    try { await jobPage.close(); } catch(e) {}
    return [];
  }
}

// ─── MAIN SEARCH FUNCTION ─────────────────────────────────────────────
async function searchJobs(location, keyword, limit, onProgress) {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(getRandomUA());

  const allJobs = [];
  const seenTitles = new Set();
  let companies = [];

  try {
    // Step 1: Find companies via Google Maps
    if (onProgress) onProgress({ status: 'started', message: 'Starting job search engine...' });

    companies = await searchCompaniesOnMaps(browser, page, location, keyword, limit, onProgress);

    if (companies.length === 0) {
      if (onProgress) onProgress({ status: 'warning', message: 'No companies with websites found in this area.' });
      await browser.close();
      if (onProgress) onProgress({ status: 'done', message: 'Search complete', jobs: [], companiesScanned: 0 });
      return { jobs: [], companiesScanned: 0 };
    }

    if (onProgress) onProgress({
      status: 'scanning_careers',
      message: `Found ${companies.length} companies. Scanning career pages...`,
      companiesFound: companies.length
    });

    // Step 2: For each company, find career page and scrape jobs
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      if (onProgress) onProgress({
        status: 'scanning_company',
        message: `Scanning: ${company.name}`,
        total: companies.length,
        current: i + 1,
        company: company.name
      });

      try {
        // Find career page
        const careerUrl = await findCareerPage(browser, company.website, onProgress);

        if (careerUrl) {
          if (onProgress) onProgress({ status: 'scanning_careers', message: `Found career page for ${company.name}, scanning jobs...` });
      
          const jobs = await scrapeJobsFromPage(browser, careerUrl, company);

          // Filter by keyword if provided
          const filteredJobs = keyword
            ? jobs.filter(j =>
                j.title.toLowerCase().includes(keyword.toLowerCase()) ||
                j.description.toLowerCase().includes(keyword.toLowerCase())
              )
            : jobs;

          // Deduplicate
          for (const job of filteredJobs) {
            const key = `${job.company}-${job.title}`.toLowerCase();
            if (!seenTitles.has(key)) {
              seenTitles.add(key);

              // Determine if remote
              const isRemote = [job.title, job.location, job.description].some(
                s => (s || '').toLowerCase().includes('remote')
              );
              const isHybrid = [job.title, job.location, job.description].some(
                s => (s || '').toLowerCase().includes('hybrid')
              );

              job.type = isRemote ? 'Remote' : isHybrid ? 'Hybrid' : 'Onsite';
              job.location = job.location || location;

              allJobs.push(job);

              if (onProgress) onProgress({
                status: 'job_found',
                message: `Job found: ${job.title} at ${job.company}`,
                job,
                totalJobs: allJobs.length
              });
            }
          }
        } else {
          if (onProgress) onProgress({
            status: 'no_career_page',
            message: `No career page found for ${company.name}`,
            total: companies.length,
            current: i + 1
          });
        }
      } catch (err) {
        if (onProgress) onProgress({
          status: 'company_error',
          message: `Error scanning ${company.name}`,
          total: companies.length,
          current: i + 1
        });
      }

      // Add delay between companies to avoid anti-bot
      await delay(800 + Math.random() * 700);
    }

  } catch (error) {
    console.error('Job search error:', error.message);
    if (onProgress) onProgress({ status: 'error', message: 'Fatal error during job search: ' + error.message });
  } finally {
    await browser.close();
    if (onProgress) onProgress({
      status: 'done',
      message: `Search complete. Found ${allJobs.length} jobs from ${companies?.length || 0} companies.`,
      totalJobs: allJobs.length,
      companiesScanned: companies?.length || 0
    });
  }

  return { jobs: allJobs, companiesScanned: companies?.length || 0 };
}

module.exports = { searchJobs };
