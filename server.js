require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const apiRoutes = require('./routes/api');

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false
  })
);

app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS']
  })
);

app.use(express.json({ limit: '10mb' }));

app.use('/api', apiRoutes);

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'lead-extract-tool-backend' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ LeadGen Pro Server running on port ${PORT}`);
});
