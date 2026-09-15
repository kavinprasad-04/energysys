'use strict';

/**
 * Wind Farm Service Request — POST /api/service-request
 * Multipart form: many text fields + up to MAX_SERVICE_FILES document uploads.
 * Stores a copy in SQLite (service_requests + service_request_files) and emails
 * the request to SERVICE_REQUEST_TO. Mirrors the architecture of enquiry.js /
 * reports.js — same mailer, same db wrapper, same upload folder convention.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('./db');
const {
  buildServiceRequestSubject,
  buildServiceRequestText,
  buildServiceRequestHtml,
} = require('./reportTemplate');
const { sendReportMail } = require('./mailer');

const router = express.Router();

const RECEIVER = (process.env.SERVICE_REQUEST_TO || process.env.REPORT_TO || 'rds@esys.co.in').trim();
const MAX_FILES = Math.max(1, Number(process.env.MAX_SERVICE_FILES || 12));
const MAX_FILE_MB = Math.max(1, Number(process.env.MAX_SERVICE_FILE_MB || 25));
// Files above this size (or total) are saved to disk but NOT attached to the email.
const ATTACH_FILE_LIMIT = 8 * 1024 * 1024;
const ATTACH_TOTAL_LIMIT = 18 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepted document types: reports, images, video, office docs, drawings, archives.
const OK_EXT = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf',
  '.dwg', '.dxf', '.zip', '.7z', '.rar',
]);

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'service-requests');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (OK_EXT.has(ext)) return cb(null, true);
    cb(new Error('File type not allowed: ' + (ext || file.originalname) +
      '. Use PDF, image, video, Office or drawing files.'));
  },
});

const insertRequest = db.prepare(`
  INSERT INTO service_requests
    (public_id, full_name, company, email, phone, country, city,
     farm_name, farm_location, turbine_count, turbine_oem, turbine_model,
     turbine_capacity_mw, farm_capacity_mw, commissioning_year,
     services, description, turbines_affected, turbine_ids, turbine_status,
     required_date, priority, comments, ip, user_agent, page)
  VALUES
    (@public_id, @full_name, @company, @email, @phone, @country, @city,
     @farm_name, @farm_location, @turbine_count, @turbine_oem, @turbine_model,
     @turbine_capacity_mw, @farm_capacity_mw, @commissioning_year,
     @services, @description, @turbines_affected, @turbine_ids, @turbine_status,
     @required_date, @priority, @comments, @ip, @user_agent, @page)`);
const insertFile = db.prepare(`
  INSERT INTO service_request_files (request_id, filename, original_name, mimetype, size, attached, sort_order)
  VALUES (@request_id, @filename, @original_name, @mimetype, @size, @attached, @sort_order)`);
const markEmailed = db.prepare(`UPDATE service_requests SET status='emailed', email_error=NULL, emailed_at=datetime('now') WHERE id=?`);
const markError = db.prepare(`UPDATE service_requests SET status='error', email_error=@err WHERE id=@id`);

function publicId() {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return 'SRQ-' + ymd + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[ \t]+/g, ' ').trim().slice(0, max || 400);
}
function safeName(name) {
  return (name || 'file').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 90);
}

// in-memory rate limit: 6 / 15 min / IP  (same as enquiry.js)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 15 * 60 * 1000, max = 6;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

function withUpload(req, res, next) {
  upload.array('documents', MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    let message = 'The uploaded files could not be processed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'A file is too large (max ' + MAX_FILE_MB + ' MB each).';
    else if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many files (max ' + MAX_FILES + ').';
    else if (err.message) message = err.message;
    return res.status(400).json({ success: false, message: message });
  });
}

router.post('/', withUpload, async (req, res) => {
  const b = req.body || {};

  // honeypot
  if (b.website && String(b.website).trim()) {
    return res.json({ success: true, message: 'Service request submitted' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Too many requests from this connection. Please try again later.' });
  }

  // "services" may arrive as repeated fields or a single comma string
  let services = b.services;
  if (Array.isArray(services)) services = services.join('\n');
  else services = String(services || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).join('\n');

  const data = {
    full_name: clean(b.full_name, 120),
    company: clean(b.company, 160),
    email: clean(b.email, 160),
    phone: clean(b.phone, 60),
    country: clean(b.country, 80),
    city: clean(b.city, 120),
    farm_name: clean(b.farm_name, 160),
    farm_location: clean(b.farm_location, 200),
    turbine_count: clean(b.turbine_count, 40),
    turbine_oem: clean(b.turbine_oem, 120),
    turbine_model: clean(b.turbine_model, 120),
    turbine_capacity_mw: clean(b.turbine_capacity_mw, 40),
    farm_capacity_mw: clean(b.farm_capacity_mw, 40),
    commissioning_year: clean(b.commissioning_year, 20),
    services: services.slice(0, 2000),
    description: String(b.description == null ? '' : b.description).trim().slice(0, 8000),
    turbines_affected: clean(b.turbines_affected, 60),
    turbine_ids: clean(b.turbine_ids, 400),
    turbine_status: clean(b.turbine_status, 120),
    required_date: clean(b.required_date, 40),
    priority: clean(b.priority, 30),
    comments: String(b.comments == null ? '' : b.comments).trim().slice(0, 4000),
  };

  // ---- validation: the spec's required (*) fields ----
  const fields = {};
  if (!data.full_name) fields.full_name = 'Please enter your full name.';
  if (!data.company) fields.company = 'Please enter your company name.';
  if (!data.email) fields.email = 'Please enter your email address.';
  else if (!EMAIL_RE.test(data.email)) fields.email = 'Please enter a valid email address.';
  if (!data.phone) fields.phone = 'Please enter your phone number.';
  if (!data.country) fields.country = 'Please enter your country.';
  if (!data.city) fields.city = 'Please enter your city or location.';
  if (!data.farm_name) fields.farm_name = 'Please enter the wind farm name.';
  if (!data.farm_location) fields.farm_location = 'Please enter the wind farm location.';
  if (!data.description) fields.description = 'Please describe the problem or service required.';
  if (Object.keys(fields).length) {
    return res.status(400).json({ success: false, message: 'Please complete the required fields.', fields: fields });
  }

  const pid = publicId();
  const dir = path.join(UPLOAD_DIR, pid);

  // ---- save uploaded files ----
  const stored = [];
  let runningTotal = 0;
  if (req.files && req.files.length) {
    fs.mkdirSync(dir, { recursive: true });
    req.files.forEach((f, i) => {
      const ext = path.extname(f.originalname || '').toLowerCase() || '.bin';
      const fname = String(i + 1).padStart(2, '0') + '-' + safeName(path.basename(f.originalname || 'file', ext)) + ext;
      fs.writeFileSync(path.join(dir, fname), f.buffer);
      const attach = f.size <= ATTACH_FILE_LIMIT && (runningTotal + f.size) <= ATTACH_TOTAL_LIMIT;
      if (attach) runningTotal += f.size;
      stored.push({
        filename: fname,
        original_name: safeName(f.originalname),
        mimetype: f.mimetype || 'application/octet-stream',
        size: f.size,
        attached: attach ? 1 : 0,
        diskPath: path.join(dir, fname),
      });
    });
  }

  // ---- persist ----
  let dbId;
  try {
    const save = db.transaction(() => {
      insertRequest.run(Object.assign({}, data, {
        public_id: pid,
        ip: ip || null,
        user_agent: clean(req.headers['user-agent'], 300) || null,
        page: clean(b.page, 200) || null,
      }));
      const id = db.prepare('SELECT id FROM service_requests WHERE public_id = ?').get(pid).id;
      stored.forEach((f, i) => insertFile.run({
        request_id: id, filename: f.filename, original_name: f.original_name,
        mimetype: f.mimetype, size: f.size, attached: f.attached, sort_order: i,
      }));
      return id;
    });
    dbId = save();
  } catch (err) {
    console.error('[service-request] save failed:', err);
    return res.status(500).json({ success: false, message: 'Unable to submit the service request.' });
  }

  // ---- email ----
  const attachments = stored
    .filter((f) => f.attached)
    .map((f) => ({ filename: f.original_name, path: f.diskPath, contentType: f.mimetype }));

  try {
    const result = await sendReportMail({
      to: [RECEIVER],
      cc: [],
      replyTo: data.email,
      subject: buildServiceRequestSubject(data),
      text: buildServiceRequestText(data, pid, stored),
      html: buildServiceRequestHtml(data, pid, stored),
      attachments: attachments,
    });
    markEmailed.run(dbId);
    return res.status(201).json({
      success: true,
      message: 'Service request submitted successfully',
      reference: pid,
      previewUrl: result.previewUrl || null,
    });
  } catch (mailErr) {
    markError.run({ id: dbId, err: String((mailErr && mailErr.message) || mailErr) });
    // The request is safely stored; tell the client it was received but not emailed.
    return res.status(502).json({
      success: false,
      message: 'Your request was saved but the confirmation email could not be sent. Our team can still see it — or email us directly.',
      reference: pid,
    });
  }
});

module.exports = router;
