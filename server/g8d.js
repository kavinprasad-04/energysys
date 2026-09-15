'use strict';

/**
 * G8D Wind Farm Service Request.
 *   POST /api/g8d/draft         — create/update a draft (JSON body, no files)
 *   GET  /api/g8d/draft/:id     — load a draft/request by its public id
 *   POST /api/g8d/submit        — final submit (multipart/form-data + files)
 *   GET  /api/g8d/report/:id.pdf — generate and stream the G8D report as a PDF
 *
 * One row per request in g8d_requests; each discipline's data is stored as a
 * JSON string in that discipline's column (D1..D8). Attachments live in
 * g8d_files + server/uploads/g8d/<public_id>/, mirroring service-request.js.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { db } = require('./db');
const { sendReportMail } = require('./mailer');
const {
  buildG8DSubject,
  buildG8DNoteText,
  buildG8DNoteHtml,
} = require('./reportTemplate');

const router = express.Router();

const RECEIVER = (process.env.SERVICE_REQUEST_TO || process.env.REPORT_TO || 'rds@esys.co.in').trim();
const MAX_FILES = Math.max(1, Number(process.env.MAX_SERVICE_FILES || 12));
const MAX_FILE_MB = Math.max(1, Number(process.env.MAX_SERVICE_FILE_MB || 25));
const ATTACH_FILE_LIMIT = 8 * 1024 * 1024;
const ATTACH_TOTAL_LIMIT = 18 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OK_EXT = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf',
  '.dwg', '.dxf', '.zip', '.7z', '.rar',
]);

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'g8d');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (OK_EXT.has(ext)) return cb(null, true);
    cb(new Error('File type not allowed: ' + (ext || file.originalname)));
  },
});

function publicId() {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return 'G8D-' + ymd + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function safeName(name) {
  return (name || 'file').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 90);
}
function asObj(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
}
function pruneDiscipline(obj, maxLen) {
  // clean strings, cap size so a runaway payload can't blow up the DB row
  var out = {};
  Object.keys(obj || {}).forEach(function (k) {
    var v = obj[k];
    if (Array.isArray(v)) {
      out[k] = v.slice(0, 60).map(function (row) {
        if (row && typeof row === 'object') {
          var r = {};
          Object.keys(row).forEach(function (rk) { r[rk] = String(row[rk] == null ? '' : row[rk]).slice(0, 1000); });
          return r;
        }
        return String(row == null ? '' : row).slice(0, 1000);
      });
    } else if (v && typeof v === 'object') {
      out[k] = v;
    } else {
      out[k] = String(v == null ? '' : v).slice(0, maxLen || 4000);
    }
  });
  return out;
}

// in-memory rate limits
function makeLimiter(max, winMs) {
  var hits = new Map();
  return function (ip) {
    var now = Date.now();
    var arr = (hits.get(ip) || []).filter(function (t) { return now - t < winMs; });
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > max;
  };
}
const draftLimited = makeLimiter(30, 15 * 60 * 1000);
const submitLimited = makeLimiter(6, 15 * 60 * 1000);

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

const insertDraft = db.prepare(`
  INSERT INTO g8d_requests (public_id, status, current_discipline, d1, d2, d3, d4, d5, d6, d7, d8, ip, user_agent, page)
  VALUES (@public_id, 'draft', @current_discipline, @d1, @d2, @d3, @d4, @d5, @d6, @d7, @d8, @ip, @user_agent, @page)`);
const updateDraft = db.prepare(`
  UPDATE g8d_requests SET
    current_discipline=@current_discipline, d1=@d1, d2=@d2, d3=@d3, d4=@d4, d5=@d5, d6=@d6, d7=@d7, d8=@d8,
    updated_at=datetime('now')
  WHERE public_id=@public_id AND status='draft'`);
const getByPublicId = db.prepare('SELECT * FROM g8d_requests WHERE public_id = ?');
const markSubmitted = db.prepare(`
  UPDATE g8d_requests SET status='submitted', current_discipline=@current_discipline,
    d1=@d1, d2=@d2, d3=@d3, d4=@d4, d5=@d5, d6=@d6, d7=@d7, d8=@d8,
    ip=@ip, user_agent=@user_agent, page=@page,
    updated_at=datetime('now'), submitted_at=datetime('now')
  WHERE public_id=@public_id`);
const markEmailed = db.prepare(`UPDATE g8d_requests SET email_error=NULL WHERE public_id=?`);
const markEmailError = db.prepare(`UPDATE g8d_requests SET email_error=@err WHERE public_id=@public_id`);
const insertFile = db.prepare(`
  INSERT INTO g8d_files (request_id, filename, original_name, mimetype, size, attached, sort_order)
  VALUES (@request_id, @filename, @original_name, @mimetype, @size, @attached, @sort_order)`);
const filesForRequest = db.prepare('SELECT * FROM g8d_files WHERE request_id = ? ORDER BY sort_order, id');

function rowToPayload(row) {
  return {
    publicId: row.public_id,
    status: row.status,
    currentDiscipline: row.current_discipline,
    d1: asObj(row.d1), d2: asObj(row.d2), d3: asObj(row.d3), d4: asObj(row.d4),
    d5: asObj(row.d5), d6: asObj(row.d6), d7: asObj(row.d7), d8: asObj(row.d8),
    createdAt: row.created_at, updatedAt: row.updated_at, submittedAt: row.submitted_at,
  };
}

/* ---------------------------------------------------------------- draft --- */
// body-parsing: the app-level express.json() (server.js) already parses this.
router.post('/draft', function (req, res) {
  var ip = clientIp(req);
  if (draftLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Too many draft saves — please wait a moment and try again.' });
  }
  var b = req.body || {};
  var d1 = pruneDiscipline(asObj(b.d1), 4000);
  var discipline = String(b.current_discipline || 'D1').slice(0, 12);
  var row = {
    current_discipline: discipline,
    d1: JSON.stringify(d1),
    d2: JSON.stringify(pruneDiscipline(asObj(b.d2), 4000)),
    d3: JSON.stringify(pruneDiscipline(asObj(b.d3), 4000)),
    d4: JSON.stringify(pruneDiscipline(asObj(b.d4), 4000)),
    d5: JSON.stringify(pruneDiscipline(asObj(b.d5), 4000)),
    d6: JSON.stringify(pruneDiscipline(asObj(b.d6), 4000)),
    d7: JSON.stringify(pruneDiscipline(asObj(b.d7), 4000)),
    d8: JSON.stringify(pruneDiscipline(asObj(b.d8), 4000)),
    ip: ip || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    page: String(b.page || '').slice(0, 200) || null,
  };

  var existingId = String(b.draft_id || '').trim();
  try {
    if (existingId) {
      var existing = getByPublicId.get(existingId);
      if (existing && existing.status === 'draft') {
        updateDraft.run(Object.assign({ public_id: existingId }, row));
        return res.json({ success: true, draftId: existingId, savedAt: new Date().toISOString() });
      }
    }
    var pid = publicId();
    insertDraft.run(Object.assign({ public_id: pid }, row));
    return res.status(201).json({ success: true, draftId: pid, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[g8d] draft save failed:', err);
    return res.status(500).json({ success: false, message: 'Unable to save the draft.' });
  }
});

router.get('/draft/:id', function (req, res) {
  var row = getByPublicId.get(String(req.params.id || '').trim());
  if (!row) return res.status(404).json({ success: false, message: 'Request not found.' });
  var payload = rowToPayload(row);
  payload.files = filesForRequest.all(row.id).map(function (f) {
    return { originalName: f.original_name, size: f.size, mimetype: f.mimetype };
  });
  return res.json({ success: true, request: payload });
});

/* --------------------------------------------------------------- submit --- */
function withUpload(req, res, next) {
  upload.array('attachments', MAX_FILES)(req, res, function (err) {
    if (!err) return next();
    var message = 'The uploaded files could not be processed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'A file is too large (max ' + MAX_FILE_MB + ' MB each).';
    else if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many files (max ' + MAX_FILES + ').';
    else if (err.message) message = err.message;
    return res.status(400).json({ success: false, message: message });
  });
}

router.post('/submit', withUpload, async function (req, res) {
  var ip = clientIp(req);
  if (submitLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Too many requests from this connection. Please try again later.' });
  }
  var b = req.body || {};

  if (b.website && String(b.website).trim()) {
    return res.json({ success: true, message: 'G8D service request submitted' });
  }

  var d1 = pruneDiscipline(asObj(b.d1), 4000);
  var d2 = pruneDiscipline(asObj(b.d2), 4000);
  var d3 = pruneDiscipline(asObj(b.d3), 4000);
  var d4 = pruneDiscipline(asObj(b.d4), 4000);
  var d5 = pruneDiscipline(asObj(b.d5), 4000);
  var d6 = pruneDiscipline(asObj(b.d6), 4000);
  var d7 = pruneDiscipline(asObj(b.d7), 4000);
  var d8 = pruneDiscipline(asObj(b.d8), 4000);

  // ---- minimum required fields (D1 + D2 core) ----
  var fields = {};
  if (!d1.team_leader) fields['d1.team_leader'] = 'Please name the D-Team leader.';
  if (!d1.company_name) fields['d1.company_name'] = 'Please enter the company name.';
  if (!d1.contact_person) fields['d1.contact_person'] = 'Please enter a contact person.';
  if (!d1.email) fields['d1.email'] = 'Please enter a contact email.';
  else if (!EMAIL_RE.test(d1.email)) fields['d1.email'] = 'Please enter a valid email address.';
  if (!d1.phone) fields['d1.phone'] = 'Please enter a contact phone number.';
  if (!d2.wind_farm_name) fields['d2.wind_farm_name'] = 'Please enter the wind farm name.';
  if (!d2.wind_farm_location) fields['d2.wind_farm_location'] = 'Please enter the wind farm location.';
  if (!d2.turbine_id) fields['d2.turbine_id'] = 'Please enter the turbine ID.';
  if (!d2.problem_description) fields['d2.problem_description'] = 'Please describe the problem (D2).';
  if (Object.keys(fields).length) {
    return res.status(400).json({ success: false, message: 'Please complete the required fields.', fields: fields });
  }

  var currentDiscipline = (d8.final_status === 'Closed') ? 'Closed' : 'D8';
  var pid = String(b.draft_id || '').trim();
  var isNew = false;
  if (!pid || !getByPublicId.get(pid)) { pid = publicId(); isNew = true; }

  // ---- save uploaded files ----
  var dir = path.join(UPLOAD_DIR, pid);
  var stored = [];
  var runningTotal = 0;
  if (req.files && req.files.length) {
    fs.mkdirSync(dir, { recursive: true });
    req.files.forEach(function (f, i) {
      var ext = path.extname(f.originalname || '').toLowerCase() || '.bin';
      var fname = String(i + 1).padStart(2, '0') + '-' + safeName(path.basename(f.originalname || 'file', ext)) + ext;
      fs.writeFileSync(path.join(dir, fname), f.buffer);
      var attach = f.size <= ATTACH_FILE_LIMIT && (runningTotal + f.size) <= ATTACH_TOTAL_LIMIT;
      if (attach) runningTotal += f.size;
      stored.push({
        filename: fname, original_name: safeName(f.originalname),
        mimetype: f.mimetype || 'application/octet-stream', size: f.size,
        attached: attach ? 1 : 0, diskPath: path.join(dir, fname),
      });
    });
  }

  var row = {
    public_id: pid,
    current_discipline: currentDiscipline,
    d1: JSON.stringify(d1), d2: JSON.stringify(d2), d3: JSON.stringify(d3), d4: JSON.stringify(d4),
    d5: JSON.stringify(d5), d6: JSON.stringify(d6), d7: JSON.stringify(d7), d8: JSON.stringify(d8),
    ip: ip || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    page: String(b.page || '').slice(0, 200) || null,
  };

  var dbId;
  try {
    var save = db.transaction(function () {
      if (isNew) {
        insertDraft.run(Object.assign({}, row, { current_discipline: 'D1' })); // create row first
      }
      markSubmitted.run(row);
      var id = getByPublicId.get(pid).id;
      stored.forEach(function (f, i) {
        insertFile.run({
          request_id: id, filename: f.filename, original_name: f.original_name,
          mimetype: f.mimetype, size: f.size, attached: f.attached, sort_order: i,
        });
      });
      return id;
    });
    dbId = save();
  } catch (err) {
    console.error('[g8d] submit save failed:', err);
    return res.status(500).json({ success: false, message: 'Unable to submit the G8D service request.' });
  }

  var attachments = stored.filter(function (f) { return f.attached; })
    .map(function (f) { return { filename: f.original_name, path: f.diskPath, contentType: f.mimetype }; });
  var data = { d1: d1, d2: d2, d3: d3, d4: d4, d5: d5, d6: d6, d7: d7, d8: d8 };

  try {
    var pdfRow = getByPublicId.get(pid);
    var pdfBuffer = await buildG8DPdfBuffer(pdfRow, filesForRequest.all(dbId));
    attachments.unshift({ filename: pid + '-G8D-Report.pdf', content: pdfBuffer, contentType: 'application/pdf' });
  } catch (pdfErr) {
    console.error('[g8d] PDF build for email failed:', pdfErr);
  }

  try {
    var result = await sendReportMail({
      to: [RECEIVER],
      replyTo: d1.email,
      subject: buildG8DSubject(data, pid),
      text: buildG8DNoteText(data, pid, currentDiscipline),
      html: buildG8DNoteHtml(data, pid, currentDiscipline),
      attachments: attachments,
    });
    markEmailed.run(pid);
    return res.status(201).json({
      success: true,
      message: 'G8D service request submitted successfully',
      reference: pid,
      status: 'Submitted',
      currentDiscipline: currentDiscipline,
      submittedAt: new Date().toISOString(),
      reportUrl: '/api/g8d/report/' + pid + '.pdf',
      previewUrl: result.previewUrl || null,
    });
  } catch (mailErr) {
    markEmailError.run({ public_id: pid, err: String((mailErr && mailErr.message) || mailErr) });
    return res.status(201).json({
      success: true,
      message: 'Your G8D request was saved. The confirmation email could not be sent, but our team can still see it.',
      reference: pid,
      status: 'Submitted',
      currentDiscipline: currentDiscipline,
      submittedAt: new Date().toISOString(),
      reportUrl: '/api/g8d/report/' + pid + '.pdf',
    });
  }
});

/* ---------------------------------------------------------------- PDF ----- */
function line(doc, label, value) {
  if (value == null || value === '') return;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#5E6B62').text(String(label).toUpperCase(), { continued: false });
  doc.font('Helvetica').fontSize(11).fillColor('#04361F').text(String(value)).moveDown(0.4);
}
function sectionHead(doc, idx, title) {
  if (doc.y > 690) doc.addPage();
  doc.moveDown(0.6);
  doc.rect(doc.x, doc.y, 515, 22).fill('#EAF1EC');
  doc.fillColor('#00753A').font('Helvetica-Bold').fontSize(11)
    .text('  ' + idx + '  —  ' + title, doc.x, doc.y + 5, { width: 505 });
  doc.moveDown(1.1);
  doc.fillColor('#04361F');
}

function renderG8DPdf(doc, row, files) {
  var d1 = asObj(row.d1), d2 = asObj(row.d2), d3 = asObj(row.d3), d4 = asObj(row.d4),
      d5 = asObj(row.d5), d6 = asObj(row.d6), d7 = asObj(row.d7), d8 = asObj(row.d8);

  // header band
  doc.rect(0, 0, doc.page.width, 70).fill('#04361F');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('EnergySYS', 40, 22);
  doc.font('Helvetica').fontSize(10).fillColor('#86E3AC').text('G8D Wind Farm Service Request Report', 40, 46);
  doc.fillColor('#04361F');
  doc.y = 90;

  doc.font('Helvetica-Bold').fontSize(14).text('Reference ' + row.public_id, 40, doc.y);
  doc.font('Helvetica').fontSize(10).fillColor('#5E6B62')
    .text('Status: ' + row.status + '   ·   Current discipline: ' + row.current_discipline +
      '   ·   Submitted: ' + (row.submitted_at || '—') + '   ·   Generated: ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
  doc.fillColor('#04361F');
  doc.moveDown(0.5);

  sectionHead(doc, 'D1', 'Establish the Team');
  line(doc, 'Team Leader', d1.team_leader);
  line(doc, 'D-Team', d1.d_team);
  if (Array.isArray(d1.team_members) && d1.team_members.length) {
    line(doc, 'Team Members', d1.team_members.map(function (m) { return (m.name || '') + (m.role ? ' (' + m.role + ')' : ''); }).filter(Boolean).join(', '));
  }
  line(doc, 'Company Name', d1.company_name);
  line(doc, 'Contact Person', d1.contact_person);
  line(doc, 'Email', d1.email);
  line(doc, 'Phone', d1.phone);
  line(doc, 'Service Engineer', d1.service_engineer);

  sectionHead(doc, 'D2', 'Describe the Problem');
  line(doc, 'Wind Farm Name', d2.wind_farm_name);
  line(doc, 'Wind Farm Location', d2.wind_farm_location);
  line(doc, 'Turbine ID', d2.turbine_id);
  line(doc, 'OEM / Manufacturer', d2.oem_manufacturer);
  line(doc, 'Turbine Model', d2.turbine_model);
  line(doc, 'Serial Number', d2.serial_number);
  line(doc, 'Component / System', d2.component_system);
  line(doc, 'Failure Date', d2.failure_date);
  line(doc, 'Number of Units Affected', d2.units_affected);
  line(doc, 'Current Turbine Status', d2.turbine_status);
  line(doc, 'Failure Category', d2.failure_category);
  line(doc, 'Fault / Error Code', d2.fault_error_code);
  line(doc, 'Detailed Problem Description', d2.problem_description);

  sectionHead(doc, 'D3', 'Interim Containment Action');
  line(doc, 'Immediate Action Taken', d3.immediate_action);
  line(doc, 'Turbine Shutdown', d3.turbine_shutdown);
  line(doc, 'Temporary Repair', d3.temporary_repair);
  line(doc, 'Temporary Solution', d3.temporary_solution);
  line(doc, 'Downtime', d3.downtime);
  line(doc, 'Safety Risk', d3.safety_risk);
  line(doc, 'Containment Details', d3.containment_details);

  sectionHead(doc, 'D4', 'Root Cause Analysis');
  [1, 2, 3, 4, 5].forEach(function (n) { line(doc, 'Why ' + n, d4['why' + n]); });
  line(doc, 'Suspected Root Cause', d4.suspected_root_cause);
  line(doc, 'Confirmed Root Cause', d4.confirmed_root_cause);
  line(doc, 'Failure Mechanism', d4.failure_mechanism);
  line(doc, 'Root Cause Category', d4.root_cause_category);

  sectionHead(doc, 'D5', 'Permanent Corrective Action');
  var actions = Array.isArray(d5.corrective_actions) ? d5.corrective_actions : [];
  if (!actions.length) { doc.font('Helvetica').fontSize(10).fillColor('#5E6B62').text('No corrective actions recorded yet.').moveDown(0.4); doc.fillColor('#04361F'); }
  actions.forEach(function (a, i) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#00753A').text('Action ' + (i + 1)).moveDown(0.2);
    doc.fillColor('#04361F');
    line(doc, 'Corrective Action', a.corrective_action);
    line(doc, 'Recommended Repair', a.recommended_repair);
    line(doc, 'Component Replacement', a.component_replacement);
    line(doc, 'Design Modification', a.design_modification);
    line(doc, 'Software / Firmware Update', a.software_update);
    line(doc, 'Maintenance Procedure Change', a.maintenance_procedure_change);
    line(doc, 'Responsible Person', a.responsible_person);
    line(doc, 'Target Completion Date', a.target_date);
    line(doc, 'Spare Parts', a.spare_parts);
    line(doc, 'Tools / Equipment', a.tools_equipment);
    doc.moveDown(0.2);
  });

  sectionHead(doc, 'D6', 'Implement & Validate Corrective Action');
  line(doc, 'Corrective Action Implemented', d6.action_implemented);
  line(doc, 'Implementation Date', d6.implementation_date);
  line(doc, 'Implemented By', d6.implemented_by);
  line(doc, 'Validation Method', d6.validation_method);
  line(doc, 'Test Performed', d6.test_performed);
  line(doc, 'Test Result', d6.test_result);
  line(doc, 'Turbine Returned to Service', d6.returned_to_service);
  line(doc, 'Performance After Repair', d6.performance_after_repair);
  line(doc, 'Monitoring Period', d6.monitoring_period);
  line(doc, 'Validation Comments', d6.validation_comments);

  sectionHead(doc, 'D7', 'Prevent Recurrence');
  line(doc, 'Preventive Action', d7.preventive_action);
  line(doc, 'Maintenance Procedure Updated', d7.maintenance_procedure_updated);
  line(doc, 'Inspection Frequency Changed', d7.inspection_frequency_changed);
  line(doc, 'Spare Parts Specification Updated', d7.spare_parts_spec_updated);
  line(doc, 'Design Change Required', d7.design_change_required);
  line(doc, 'Supplier / OEM Action', d7.supplier_oem_action);
  line(doc, 'Training Required', d7.training_required);
  line(doc, 'Documentation Updated', d7.documentation_updated);
  line(doc, 'Similar Turbines Inspected', d7.similar_turbines_inspected);
  line(doc, 'Lessons Learned', d7.lessons_learned);

  sectionHead(doc, 'D8', 'Closure & Recognition');
  line(doc, 'G8D Completion Date', d8.completion_date);
  line(doc, 'Final Problem Status', d8.final_status);
  line(doc, 'Final Verification', d8.final_verification);
  line(doc, 'Customer Approval', d8.customer_approval);
  line(doc, 'Customer Comments', d8.customer_comments);
  line(doc, 'Service Engineer Approval', d8.service_engineer_approval);
  line(doc, 'Team Leader Approval', d8.team_leader_approval);

  if (files.length) {
    sectionHead(doc, 'ATT', 'Attachments');
    files.forEach(function (f) {
      doc.font('Helvetica').fontSize(10).fillColor('#04361F')
        .text('• ' + f.original_name + '  (' + Math.max(1, Math.round(f.size / 1024)) + ' KB' + (f.attached ? '' : ', stored on server') + ')');
    });
  }
}

function buildG8DPdfBuffer(row, files) {
  return new Promise(function (resolve, reject) {
    try {
      var doc = new PDFDocument({ size: 'A4', margin: 40 });
      var chunks = [];
      doc.on('data', function (c) { chunks.push(c); });
      doc.on('end', function () { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);
      renderG8DPdf(doc, row, files);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

router.get('/report/:id.pdf', function (req, res) {
  var row = getByPublicId.get(String(req.params.id || '').trim());
  if (!row) return res.status(404).send('Report not found.');
  var files = filesForRequest.all(row.id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + row.public_id + '-G8D-Report.pdf"');

  var doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);
  renderG8DPdf(doc, row, files);
  doc.end();
});

module.exports = router;
