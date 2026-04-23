const scraper = require('./services/jobScraper');

(async () => {
  console.log("Starting job scraper...");
  try {
    const jobs = await scraper.searchJobs('Austin, TX', 'Software', 5, (update) => {
      console.log("PROGRESS:", update.status, "-", update.message);
    });
    console.log("Found jobs:", jobs.length);
    console.log(jobs);
  } catch (err) {
    console.error("Error:", err);
  }
})();
