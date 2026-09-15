# Service / Failure Report tool

An **open** (no login) 8D-style failure-report form that saves every report to a
database and emails a professional report — with the uploaded evidence images —
to a **fixed address**: `kavinprasad887@gmail.com` (plus an optional CC).

It is bolted onto the existing static site: the Node server now serves the whole
website *and* the report API on one port. The marketing pages are unchanged apart
from the nav label ("Services" → "Service").

> ⚠️ **No authentication.** The Service form and the "Past reports" browse page are
> reachable by **anyone who can open the site** (it is the same server as the public
> marketing pages). Anyone can submit reports to `kavinprasad887@gmail.com` and read
> every stored report. If that matters later, run this tool on an internal-only
> host / behind VPN / IP allow-list, or re-add the shared-code gate.

---

## 1. What was added / changed

### New files

| File | Purpose |
|------|---------|
| `package.json` | dependencies + `npm start` / `npm run dev` |
| `.gitignore` | ignores `node_modules/`, `server/.env`, `server/data/`, `server/uploads/` |
| `server/server.js` | Express app — serves the static site + mounts the API |
| `server/db.js` | database on Node's built-in `node:sqlite` (no native build) + schema |
| `server/reports.js` | `/api/reports` create+email, list, detail, image serve, resend |
| `server/enquiry.js` | `/api/enquiry` — website contact form: validates, saves to the `enquiries` table, emails to `ENQUIRY_TO` (honeypot + rate-limit) |
| `server/mailer.js` | Nodemailer transport (real SMTP, or Ethereal test inbox as fallback) |
| `server/reportTemplate.js` | builds the plain-text + HTML email bodies |
| `server/.env.example` | template for the SMTP secrets — **copy to `server/.env`** |
| `service-reports.html` | "Past reports" list + detail + re-send |
| `assets/css/service.css` | styles for the tool (loaded only on the 2 tool pages) |
| `assets/js/service-auth.js` | shared fetch + toast helpers (no auth) |
| `assets/js/service-report.js` | the report form logic |
| `assets/js/service-reports.js` | list + detail modal logic |

### Modified files

| File | Change |
|------|--------|
| `services.html` | **replaced** with the failure-report form (opens directly, no login) |
| `index/about/products/resources/news/contact/404.html` | nav label `Services` → `Service` (one line each) |
| `README.md` | pointer to this file |

### Removed

`login.html`, `server/auth.js`, `server/sessionStore.js` (auth was dropped), and the
`express-session` / `bcryptjs` dependencies.

### Created at runtime (git-ignored — safe to delete)

```
node_modules/
server/.env                       <- you create this from .env.example
server/data/service-reports.db    <- SQLite database (+ -wal / -shm)
server/uploads/<REPORT-REF>/*      <- stored evidence images
```

---

## 2. Install

Node 22.5+ required (uses the built-in `node:sqlite`). You have Node 24.

```bash
cd "C:\Users\kavin\OneDrive\Desktop\energysys"
npm install
```

Installs `express`, `multer`, `nodemailer`, `dotenv` — all pure JavaScript, **no
build tools**. `npm audit` currently reports 3 *moderate* transitive issues in
Express 4's `qs`/`body-parser`; clearing them needs Express 5 (a breaking upgrade) —
fine to leave for an internal tool.

---

## 3. Configure email (`server/.env`)

Every report is emailed **from and to `kavinprasad887@gmail.com`** via Gmail SMTP.

```bash
copy server\.env.example server\.env
```

Then in `server/.env` set the Gmail **App password**:

1. On the `kavinprasad887@gmail.com` Google account, turn on **2-Step Verification**.
2. Google Account → **Security → App passwords** → create one for *Mail*.
3. Paste the 16-character value (remove spaces) as `EMAIL_PASSWORD`.

```
REPORT_TO=kavinprasad887@gmail.com          # fixed recipient (change to redirect)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=kavinprasad887@gmail.com
EMAIL_PASSWORD=xxxxxxxxxxxxxxxx              # <-- the Gmail App password
EMAIL_FROM="EnergySYS Service <kavinprasad887@gmail.com>"
# REPORT_BCC=                               # optional extra copy
MAX_IMAGES=8
MAX_IMAGE_MB=10
```

**Until `EMAIL_PASSWORD` is set**, the server routes each email to a free **Ethereal**
test inbox and returns a **preview link** (shown in the success toast) so you can
verify the report layout first. Nothing is actually delivered in that mode.

Credentials live **only** in `server/.env` (git-ignored) and are read by the
backend. The browser bundle contains no secrets.

---

## 4. Run

```bash
npm start
```

- Whole site + API: `http://localhost:3000`
- Report form:  `http://localhost:3000/services.html`  (also the **Service** nav item)
- Past reports: `http://localhost:3000/service-reports.html`

`npm run dev` restarts on file changes.

---

## 5. Test the full workflow

1. `npm start`, click **Service** in the nav (or open `/services.html`) — it opens
   straight to the form, no login.
2. Fields are pre-filled with the FM-radio example from the brief. Edit anything.
   - *Affected Units / Failure* — add/remove lines.
   - *Team (D1)* — editable table, add/remove rows (starts with Soundar & Saravanan).
   - *Problem Images* — click or drag JPG/PNG/WEBP; each gets a preview, a caption
     box and a remove button. Large images are downscaled in the browser first.
   - *Entered By* — a normal field; the browser remembers your last value.
     *Updated By* mirrors it. Created/updated timestamps are automatic.
3. Section 6 shows **"Report is emailed to: kavinprasad887@gmail.com"** (no recipient
   box). Add a **CC** if you like; check the auto **Subject**
   (`Service Failure Report – Unit Dead – FM Radio`).
4. Click **Send Service Report** — spinner, button disabled, a double-click / retry
   re-uses the same idempotency key and will **not** send twice.
5. Success toast shows the report **reference** (e.g. `SR-20260903-1A2B3C`). In test
   mode it also has a **"view test email"** link.
6. **Past reports** (top-right) → every saved report, newest first → click a row for
   the full detail + **Re-send to kavinprasad887@gmail.com**.
7. With the Gmail App password set, `kavinprasad887@gmail.com` receives the branded
   HTML report — symptom table, D1 team table, D2 description, record block, and the
   evidence images inline *and* attached — plus a plain-text version.

### Quick API check (no auth)

```bash
curl http://localhost:3000/api/health           # {"ok":true,"reportTo":"..."}
curl http://localhost:3000/api/reports           # list of saved reports
```

---

## 6. Reset

```bash
# stop the server first
rmdir /s /q server\data
rmdir /s /q server\uploads
```

## 7. Notes / possible follow-ups

- **Exposure:** see the warning at the top. Easiest hardening without full auth is a
  single shared access code before the form — say the word and I'll add it back.
- **Gmail limits:** a normal Gmail account allows ~500 emails/day via SMTP — plenty
  for service reports. If Google blocks the first send, confirm 2-Step Verification
  is on and the App password (not the normal password) is in `.env`.
- **Deployment:** put it behind nginx/IIS with HTTPS and run under a process manager
  (pm2 / NSSM). Set `REPORT_TO` per environment if needed.
