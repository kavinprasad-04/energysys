'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');

require('./db'); // initialise the database / schema
const reportsRouter = require('./reports');
const enquiryRouter = require('./enquiry');
const serviceRequestRouter = require('./service-request');
const g8dRouter = require('./g8d');
const newsRouter = require('./news');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_ROOT = path.join(__dirname, '..');

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- API -----------------------------------------------------------
app.use('/api/reports', reportsRouter);
app.use('/api/send-query', enquiryRouter); // canonical
app.use('/api/enquiry', enquiryRouter);    // alias (existing)
app.use('/api/service-request', serviceRequestRouter);
app.use('/api/g8d', g8dRouter);
app.use('/api/news', newsRouter);
app.get('/api/health', (req, res) => res.json({
  ok: true,
  reportTo: (process.env.REPORT_TO || 'rds@esys.co.in').trim(),
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// ---- Static site -------------------------------------------------
// Serve the existing HTML/CSS/JS site unchanged.
app.use(express.static(SITE_ROOT, { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(SITE_ROOT, 'index.html')));

// 404 -> the site's 404 page
app.use((req, res) => res.status(404).sendFile(path.join(SITE_ROOT, '404.html')));

app.listen(PORT, () => {
  console.log('\n  EnergySYS site + Service Report API');
  console.log('  →  http://localhost:' + PORT);
  console.log('  →  Service form:  http://localhost:' + PORT + '/services.html');
  console.log('  →  Past reports:  http://localhost:' + PORT + '/service-reports.html\n');
});
