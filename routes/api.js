const express = require('express');
const router = express.Router();
const { extractLeads } = require('../services/mapsService');
const { searchJobs } = require('../services/jobScraper');

// GET /api/jobs/search-stream?location=X&keyword=Y&limit=10
router.get('/jobs/search-stream', async (req, res) => {
  const { location, keyword, limit = 15 } = req.query;

  if (!location) {
    return res.status(400).json({ error: 'Location is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform', // no-transform is critical for proxies
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // specifically tells Nginx (often used by hosts) not to buffer
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ status: 'started', message: 'Initializing job search engine...' });

    await searchJobs(location, keyword || '', parseInt(limit), (progressUpdate) => {
      sendEvent(progressUpdate);
    });

  } catch (error) {
    console.error('Job Search Stream Error:', error);
    sendEvent({ status: 'error', message: 'Fatal job search error.' });
  } finally {
    res.end();
  }
});

// GET /api/search-stream?category=X&location=Y&limit=10
router.get('/search-stream', async (req, res) => {
  const { category, location, limit = 10 } = req.query;

  if (!category || !location) {
    return res.status(400).json({ error: 'Category and location are required' });
  }

res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform', // no-transform is critical for proxies
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no' // specifically tells Nginx (often used by hosts) not to buffer
});

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ status: 'started', message: 'Initializing automation engine...' });

    await extractLeads(category, location, parseInt(limit), (progressUpdate) => {
      if (progressUpdate.status === 'lead_found') {
        let lead = progressUpdate.lead;
        let tags = [];
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
    sendEvent({ status: 'error', message: 'Fatal extraction error.' });
  } finally {
    res.end();
  }
});

module.exports = router;
