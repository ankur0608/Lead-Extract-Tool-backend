const mongoose = require('mongoose');

const LeadListSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  total_leads: {
    type: Number,
    default: 0
  },
  emails_found: {
    type: Number,
    default: 0
  },
  leads: [{
    name: String,
    phone: String,
    website: String,
    email: String,
    address: String,
    rating: String,
    reviews: String,
    category: String,
    maps_url: String,
    tags: [String],
    outreach_idea: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('LeadList', LeadListSchema);
