const express = require('express');
const router = express.Router();
const { extractLeads } = require('../services/mapsService');
const { searchJobs } = require('../services/jobScraper');

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 10000\n\n');

  const sendEvent = (data) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(': ping\n\n');
  }, 15000);

  let aborted = false;
  req.on('close', () => {
    aborted = true;
    clearInterval(heartbeat);
  });

  const close = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  return { sendEvent, close, isAborted: () => aborted };
}

// GET /api/search-stream?category=X&location=Y&limit=10
router.get('/search-stream', async (req, res) => {
  const { category, location, limit = 10 } = req.query;

  if (!category || !location) {
    return res.status(400).json({ error: 'Category and location are required' });
  }

  const { sendEvent, close, isAborted } = openStream(req, res);

  try {
    sendEvent({ status: 'started', message: 'Initializing automation engine...' });

    await extractLeads(category, location, parseInt(limit), (progressUpdate) => {
      if (isAborted()) return;

      if (progressUpdate.status === 'lead_found') {
        const lead = progressUpdate.lead;
        const tags = [];
        let outreach_idea = '';

        if (lead.email) tags.push('Email Found');
        if (!lead.website) {
          tags.push('Missing Website');
          outreach_idea = `Hi, I noticed ${lead.name} doesn't have a website on Google Maps. We can help!`;
        }
        if (lead.rating && parseFloat(lead.rating) < 3.8) {
          tags.push('Low Rated');
          if (!outreach_idea) outreach_idea = `Hi, we noticed ${lead.name}'s rating could be improved. We specialize in reputation management.`;
        }
        if (tags.length === 0) tags.push('Standard');

        progressUpdate.lead = { ...lead, tags, outreach_idea };
      }
      sendEvent(progressUpdate);
    });
  } catch (error) {
    console.error('Search Stream Error:', error);
    sendEvent({ status: 'error', message: error && error.message ? error.message : 'Fatal extraction error.' });
  } finally {
    close();
  }
});

// GET /api/jobs/search-stream?location=X&keyword=Y&limit=10
router.get('/jobs/search-stream', async (req, res) => {
  const { location, keyword, limit = 15 } = req.query;

  if (!location) {
    return res.status(400).json({ error: 'Location is required' });
  }

  const { sendEvent, close, isAborted } = openStream(req, res);

  try {
    sendEvent({ status: 'started', message: 'Initializing job search engine...' });

    await searchJobs(location, keyword || '', parseInt(limit), (progressUpdate) => {
      if (isAborted()) return;
      sendEvent(progressUpdate);
    });
  } catch (error) {
    console.error('Job Search Stream Error:', error);
    sendEvent({ status: 'error', message: error && error.message ? error.message : 'Fatal job search error.' });
  } finally {
    close();
  }
});

router.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
