'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('./db');
const { buildSubject, buildText, buildHtml } = require('./reportTemplate');
const { sendReportMail, smtpConfigured } = require('./mailer');

const router = express.Router();

// Fixed destination for every service report. Override with REPORT_TO in server/.env.
const REPORT_TO = (process.env.REPORT_TO || 'rds@esys.co.in').trim();

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const MAX_IMAGE_MB = Math.max(1, Number(process.env.MAX_IMAGE_MB || 10));
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported image type: ' + file.mimetype + ' (use JPG, PNG or WEBP).'));
  },
});

// ---- prepared statements -------------------------------------------------
const insertReport = db.prepare(`
  INSERT INTO reports
    (public_id, product, symptom_title, symptom_description, symptom_category, affected_units,
     initial_response_date, era, era_date, contained_24h, problem_description, failure_mode,
     entered_by, updated_by, recipient_emails, cc_emails, email_subject, status, idempotency_key)
  VALUES
    (@public_id, @product, @symptom_title, @symptom_description, @symptom_category, @affected_units,
     @initial_response_date, @era, @era_date, @contained_24h, @problem_description, @failure_mode,
     @entered_by, @updated_by, @recipient_emails, @cc_emails, @email_subject, 'draft', @idempotency_key)
`);
const insertTeam = db.prepare(`
  INSERT INTO report_team (report_id, member_name, role, mobile, email, remarks, sort_order)
  VALUES (@report_id, @member_name, @role, @mobile, @email, @remarks, @sort_order)`);
const insertImage = db.prepare(`
  INSERT INTO report_images (report_id, filename, original_name, caption, mimetype, size, sort_order)
  VALUES (@report_id, @filename, @original_name, @caption, @mimetype, @size, @sort_order)`);
const getReport = db.prepare('SELECT * FROM reports WHERE id = ?');
const getByIdem = db.prepare('SELECT * FROM reports WHERE idempotency_key = ?');
const getTeam = db.prepare('SELECT * FROM report_team WHERE report_id = ? ORDER BY sort_order, id');
const getImages = db.prepare('SELECT * FROM report_images WHERE report_id = ? ORDER BY sort_order, id');
const markSent = db.prepare(`UPDATE reports SET status='sent', email_error=NULL,
  last_emailed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`);
const markError = db.prepare(`UPDATE reports SET status='error', email_error=@err,
  updated_at=datetime('now') WHERE id=@id`);
const listReports = db.prepare(`
  SELECT r.id, r.public_id, r.product, r.symptom_title, r.symptom_category, r.status,
         r.entered_by, r.created_at, r.last_emailed_at,
         (SELECT COUNT(*) FROM report_images i WHERE i.report_id = r.id) AS image_count
  FROM reports r
  ORDER BY r.created_at DESC
  LIMIT 200`);

// ---- helpers -----------------------------------------------------------
function newPublicId() {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return 'SR-' + ymd + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function parseEmails(raw) {
  return String(raw || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hydrate(report) {
  let units = [];
  try { units = JSON.parse(report.affected_units || '[]'); } catch (_) { units = []; }
  return Object.assign({}, report, { affected_units_list: Array.isArray(units) ? units : [] });
}
function extFor(mimetype) {
  return ({ 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[mimetype] || '.img';
}

// Guard against a double-click / retry sending twice at once.
const inFlight = new Set();

// ---- POST /api/reports  (create + email) -----------------------------
router.post('/', upload.array('images', MAX_IMAGES), async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload || '{}');
  } catch (_) {
    return res.status(400).json({ error: 'Malformed form payload.' });
  }

  const idem = (req.get('Idempotency-Key') || payload.idempotencyKey || '').slice(0, 80) || null;

  // Idempotent replay -> return the existing report instead of re-sending.
  if (idem) {
    const existing = getByIdem.get(idem);
    if (existing) {
      return res.status(200).json({
        ok: existing.status === 'sent',
        duplicate: true,
        reportId: existing.id,
        publicId: existing.public_id,
        status: existing.status,
        message: existing.status === 'sent'
          ? 'This report was already submitted and emailed.'
          : 'This report was already saved but the email did not go out. Open it from Past reports to retry.',
      });
    }
    if (inFlight.has(idem)) {
      return res.status(409).json({ error: 'This report is already being sent. Please wait.' });
    }
    inFlight.add(idem);
  }

  try {
    // ---- validation ------------------------------------------------
    const errors = {};
    const need = (k, label) => {
      if (!payload[k] || !String(payload[k]).trim()) errors[k] = (label || k) + ' is required.';
    };
    need('symptom_title', 'Symptom Title');
    need('symptom_description', 'Symptom Description');
    need('symptom_category', 'Symptom Category');
    need('problem_description', 'Problem Description');
    need('failure_mode', 'Failure Mode');
    need('entered_by', 'Entered By');

    const recipients = [REPORT_TO];
    const cc = parseEmails(payload.cc_emails);
    const badCc = cc.filter((e) => !EMAIL_RE.test(e));
    if (badCc.length) errors.cc_emails = 'Invalid CC address: ' + badCc.join(', ');

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
    }

    // ---- persist -------------------------------------------------
    const publicId = newPublicId();
    const affectedUnits = Array.isArray(payload.affected_units)
      ? payload.affected_units.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const team = Array.isArray(payload.team) ? payload.team : [];
    const captions = Array.isArray(payload.imageCaptions) ? payload.imageCaptions : [];
    const enteredBy = String(payload.entered_by || '').trim();
    const updatedBy = String(payload.updated_by || payload.entered_by || '').trim();

    const subject = buildSubject({
      email_subject: payload.email_subject,
      symptom_title: payload.symptom_title,
      product: payload.product,
    });

    const tx = db.transaction(() => {
      const info = insertReport.run({
        public_id: publicId,
        product: (payload.product || '').trim() || null,
        symptom_title: payload.symptom_title.trim(),
        symptom_description: (payload.symptom_description || '').trim(),
        symptom_category: (payload.symptom_category || '').trim(),
        affected_units: JSON.stringify(affectedUnits),
        initial_response_date: (payload.initial_response_date || '').trim() || null,
        era: (payload.era || '').trim(),
        era_date: (payload.era_date || '').trim() || null,
        contained_24h: (payload.contained_24h || '').trim() || null,
        problem_description: (payload.problem_description || '').trim(),
        failure_mode: (payload.failure_mode || '').trim(),
        entered_by: enteredBy,
        updated_by: updatedBy,
        recipient_emails: recipients.join(', '),
        cc_emails: cc.join(', '),
        email_subject: subject,
        idempotency_key: idem,
      });
      const reportId = info.lastInsertRowid;

      team.forEach((m, i) => {
        if (!m) return;
        const any = ['member_name', 'role', 'mobile', 'email', 'remarks'].some((k) => m[k] && String(m[k]).trim());
        if (!any) return;
        insertTeam.run({
          report_id: reportId,
          member_name: (m.member_name || '').trim(),
          role: (m.role || '').trim(),
          mobile: (m.mobile || '').trim(),
          email: (m.email || '').trim(),
          remarks: (m.remarks || '').trim(),
          sort_order: i,
        });
      });

      const files = req.files || [];
      const dir = path.join(UPLOAD_DIR, publicId);
      if (files.length) fs.mkdirSync(dir, { recursive: true });
      files.forEach((f, i) => {
        const fname = String(i + 1).padStart(2, '0') + '-' + crypto.randomBytes(4).toString('hex') + extFor(f.mimetype);
        fs.writeFileSync(path.join(dir, fname), f.buffer);
        insertImage.run({
          report_id: reportId,
          filename: fname,
          original_name: f.originalname || null,
          caption: (captions[i] || '').toString().trim(),
          mimetype: f.mimetype,
          size: f.size,
          sort_order: i,
        });
      });

      return reportId;
    });

    const reportId = tx();

    // ---- build + send email ------------------------------------
    const report = hydrate(getReport.get(reportId));
    const teamRows = getTeam.all(reportId);
    const imgRows = getImages.all(reportId).map((img, i) => Object.assign({}, img, { cid: 'img' + (i + 1) + '@esys' }));

    const attachments = imgRows.map((img) => ({
      filename: img.original_name || img.filename,
      path: path.join(UPLOAD_DIR, report.public_id, img.filename),
      cid: img.cid,
      contentType: img.mimetype,
    }));

    const text = buildText(report, teamRows, imgRows);
    const html = buildHtml(report, teamRows, imgRows);

    try {
      const result = await sendReportMail({
        to: recipients, cc, subject: report.email_subject, text, html, attachments,
      });
      markSent.run(reportId);
      return res.status(201).json({
        ok: true,
        reportId,
        publicId: report.public_id,
        status: 'sent',
        recipients,
        cc,
        previewUrl: result.previewUrl || null,
        message: result.previewUrl
          ? 'Report saved. Email SMTP is not configured yet, so it went to a test inbox — open the preview link to view it.'
          : 'Report saved and emailed to ' + recipients.join(', ') + (cc.length ? ' (cc ' + cc.join(', ') + ')' : '') + '.',
      });
    } catch (mailErr) {
      markError.run({ id: reportId, err: String((mailErr && mailErr.message) || mailErr) });
      return res.status(502).json({
        ok: false,
        reportId,
        publicId: report.public_id,
        status: 'error',
        error: 'The report was saved but the email failed to send: ' + ((mailErr && mailErr.message) || mailErr) +
          (smtpConfigured() ? '' : ' — set EMAIL_* in server/.env.'),
      });
    }
  } catch (err) {
    console.error('[reports] create failed:', err);
    return res.status(500).json({ error: 'Could not process the report: ' + (err.message || err) });
  } finally {
    if (idem) inFlight.delete(idem);
  }
});

// ---- GET /api/reports  (list) ---------------------------------------
router.get('/', (req, res) => {
  res.json({ reports: listReports.all(), reportTo: REPORT_TO });
});

// ---- GET /api/reports/:id  (detail) -------------------------------
router.get('/:id(\\d+)', (req, res) => {
  const report = getReport.get(Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  res.json({
    report: hydrate(report),
    reportTo: REPORT_TO,
    team: getTeam.all(report.id),
    images: getImages.all(report.id).map((i) => ({
      id: i.id, caption: i.caption, original_name: i.original_name,
      mimetype: i.mimetype, size: i.size,
      url: `/api/reports/${report.id}/images/${i.id}`,
    })),
  });
});

// ---- GET /api/reports/:id/images/:imageId -------------------------
router.get('/:id(\\d+)/images/:imageId(\\d+)', (req, res) => {
  const report = getReport.get(Number(req.params.id));
  if (!report) return res.sendStatus(404);
  const img = getImages.all(report.id).find((i) => i.id === Number(req.params.imageId));
  if (!img) return res.sendStatus(404);
  const file = path.join(UPLOAD_DIR, report.public_id, img.filename);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.type(img.mimetype).sendFile(file);
});

// ---- POST /api/reports/:id/resend --------------------------------
router.post('/:id(\\d+)/resend', express.json(), async (req, res) => {
  const report = getReport.get(Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  const lockKey = 'resend:' + report.id;
  if (inFlight.has(lockKey)) return res.status(409).json({ error: 'This report is already being sent.' });
  inFlight.add(lockKey);
  try {
    const recipients = [REPORT_TO];
    const cc = parseEmails((req.body && req.body.cc_emails) || report.cc_emails);
    if (cc.some((e) => !EMAIL_RE.test(e))) {
      return res.status(400).json({ error: 'Invalid CC address.' });
    }

    const h = hydrate(report);
    const teamRows = getTeam.all(report.id);
    const imgRows = getImages.all(report.id).map((img, i) => Object.assign({}, img, { cid: 'img' + (i + 1) + '@esys' }));
    const attachments = imgRows.map((img) => ({
      filename: img.original_name || img.filename,
      path: path.join(UPLOAD_DIR, report.public_id, img.filename),
      cid: img.cid, contentType: img.mimetype,
    }));

    const result = await sendReportMail({
      to: recipients, cc, subject: report.email_subject,
      text: buildText(h, teamRows, imgRows), html: buildHtml(h, teamRows, imgRows), attachments,
    });
    db.prepare('UPDATE reports SET recipient_emails=?, cc_emails=? WHERE id=?')
      .run(recipients.join(', '), cc.join(', '), report.id);
    markSent.run(report.id);
    res.json({
      ok: true, status: 'sent', recipients, cc,
      previewUrl: result.previewUrl || null,
      message: result.previewUrl ? 'Re-sent to the test inbox.' : 'Re-sent to ' + recipients.join(', ') + '.',
    });
  } catch (err) {
    markError.run({ id: report.id, err: String((err && err.message) || err) });
    res.status(502).json({ error: 'Send failed: ' + (err.message || err) });
  } finally {
    inFlight.delete(lockKey);
  }
});

// multer / body errors
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Upload error.' });
  next();
});

module.exports = router;
