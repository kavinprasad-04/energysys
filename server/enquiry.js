'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('./db');
const { buildEnquiryText, buildEnquiryHtml } = require('./reportTemplate');
const { sendReportMail } = require('./mailer');

const router = express.Router();

// Where website queries are emailed. Spec env name first, then fallbacks.
const RECEIVER = (process.env.QUERY_RECEIVER_EMAIL || process.env.ENQUIRY_TO || 'rds@esys.co.in').trim();
const MAX_MB = Math.max(1, Number(process.env.MAX_ATTACHMENT_MB || 10));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'enquiries');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const okExt = ['.jpg', '.jpeg', '.png', '.pdf'].indexOf(ext) !== -1;
    if (ALLOWED[file.mimetype] && okExt) return cb(null, true);
    cb(new Error('Only JPG, PNG or PDF files are allowed.'));
  },
});

const insert = db.prepare(`
  INSERT INTO enquiries
    (public_id, name, company, email, phone, query_type, subject, message, ref, page,
     ip, user_agent, attachment_filename, attachment_original, attachment_mimetype, attachment_size)
  VALUES
    (@public_id, @name, @company, @email, @phone, @query_type, @subject, @message, @ref, @page,
     @ip, @user_agent, @attachment_filename, @attachment_original, @attachment_mimetype, @attachment_size)`);
const markEmailed = db.prepare(`UPDATE enquiries SET status='emailed', email_error=NULL, emailed_at=datetime('now') WHERE id=?`);
const markError = db.prepare(`UPDATE enquiries SET status='error', email_error=@err WHERE id=@id`);

function publicId() {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return 'ENQ-' + ymd + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[ \t]+/g, ' ').trim().slice(0, max || 400);
}
function safeName(name) {
  return (name || 'attachment').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}

// in-memory rate limit: 6 / 15 min / IP
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 15 * 60 * 1000, max = 6;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

// Wrap multer so its errors become clean JSON instead of stack traces.
function withUpload(req, res, next) {
  upload.single('attachment')(req, res, (err) => {
    if (!err) return next();
    let message = 'The attachment could not be processed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Attachment is too large (max ' + MAX_MB + ' MB).';
    else if (err.message) message = err.message;
    return res.status(400).json({ success: false, message: message });
  });
}

router.post('/', withUpload, async (req, res) => {
  const b = req.body || {};

  // honeypot — pretend success, do nothing
  if (b.website && String(b.website).trim()) {
    return res.json({ success: true, message: 'Query sent successfully' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Too many queries from this connection. Please try again later.' });
  }

  const data = {
    name: clean(b.name, 120),
    company: clean(b.company, 160),
    email: clean(b.email, 160),
    phone: clean(b.phone || b.mobile, 60),
    query_type: clean(b.query_type || b.queryType, 60),
    subject: clean(b.subject, 200),
    message: String(b.message == null ? '' : b.message).trim().slice(0, 8000),
    ref: clean(b.ref, 80),
    page: clean(b.page, 200),
  };

  // ---- validation (spec: name, email format, subject, message) ----
  const fields = {};
  if (!data.name) fields.name = 'Please enter your name.';
  if (!data.email) fields.email = 'Please enter your email address.';
  else if (!EMAIL_RE.test(data.email)) fields.email = 'Please enter a valid email address.';
  if (!data.subject) fields.subject = 'Please enter a subject.';
  if (!data.message) fields.message = 'Please enter your query.';
  if (Object.keys(fields).length) {
    return res.status(400).json({ success: false, message: 'Please complete the required fields.', fields: fields });
  }

  // ---- attachment ----
  let att = null;
  const pid = publicId();
  if (req.file) {
    const ext = ALLOWED[req.file.mimetype] || path.extname(req.file.originalname || '') || '.bin';
    const stored = 'file' + ext;
    const dir = path.join(UPLOAD_DIR, pid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, stored), req.file.buffer);
    att = {
      stored: stored,
      original: safeName(req.file.originalname),
      mimetype: req.file.mimetype,
      size: req.file.size,
      diskPath: path.join(dir, stored),
    };
  }

  // ---- persist ----
  try {
    insert.run({
      public_id: pid,
      name: data.name, company: data.company, email: data.email, phone: data.phone,
      query_type: data.query_type || null, subject: data.subject, message: data.message,
      ref: data.ref || null, page: data.page || null,
      ip: ip || null, user_agent: clean(req.headers['user-agent'], 300) || null,
      attachment_filename: att ? att.stored : null,
      attachment_original: att ? att.original : null,
      attachment_mimetype: att ? att.mimetype : null,
      attachment_size: att ? att.size : null,
    });
  } catch (err) {
    console.error('[send-query] save failed:', err);
    return res.status(500).json({ success: false, message: 'Unable to send query' });
  }
  const dbId = db.prepare('SELECT id FROM enquiries WHERE public_id = ?').get(pid).id;

  // ---- email ----
  const emailSubject = 'New Website Query – ' + data.subject;
  const tplData = Object.assign({}, data, {
    attachment_original: att ? att.original : '',
    attachment_size: att ? att.size : 0,
  });
  const attachments = att ? [{ filename: att.original, path: att.diskPath, contentType: att.mimetype }] : [];

  try {
    const result = await sendReportMail({
      to: [RECEIVER],
      cc: [],
      replyTo: data.email,
      subject: emailSubject,
      text: buildEnquiryText(tplData, pid),
      html: buildEnquiryHtml(tplData, pid),
      attachments: attachments,
    });
    markEmailed.run(dbId);
    return res.status(201).json({
      success: true,
      message: 'Query sent successfully',
      reference: pid,
      previewUrl: result.previewUrl || null,
    });
  } catch (mailErr) {
    markError.run({ id: dbId, err: String((mailErr && mailErr.message) || mailErr) });
    return res.status(502).json({ success: false, message: 'Unable to send query' });
  }
});

module.exports = router;
