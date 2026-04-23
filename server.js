require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const apiRoutes = require('./routes/api');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api', apiRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ LeadGen Pro Server running on port ${PORT}`);
});
