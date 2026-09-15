# EnergySYS website

Static, multi-page marketing + catalogue site for **EnergySYS** (wind turbine parts &
service, a Twintronics enterprise). Plain HTML/CSS/JS — no build step, no framework.
Host it anywhere that serves files (Netlify, cPanel, S3, GitHub Pages, nginx…).

> **Service / Failure Report tool** — the `Service` nav item opens an 8D
> failure-report form (no login) that saves to a database and emails a formatted
> report + evidence images to a fixed address. It needs the bundled Node server
> (`npm install && npm start`). Full setup, `.env` config and test steps:
> **[SERVICE-REPORT.md](SERVICE-REPORT.md)**. The rest of the site is still pure
> static HTML and works without Node.

Reference/inspiration brief: `nutechwindparts.com` — structure and B2B "catalogue +
enquiry" model reproduced with EnergySYS branding, palette and a distinct visual
language (engineering-blueprint hero + monospace technical margin).

---

## Run it locally

Any static server. For example:

```bash
python -m http.server 8899
```

Then open http://localhost:8899/ . Opening the files directly with `file://` also
works, but the products filter reads URL query strings, so a server is better.

---

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home — hero, clients strip, capabilities, categories, featured parts, segments, CTA |
| `about.html` | Company overview, timeline, quality |
| `products.html` | Catalogue — filter by category / search, 19 sample parts, "Ask price" → enquiry |
| `services.html` | The 7 service lines in detail + how an order runs |
| `resources.html` | `#clients` · `#quality` · `#careers` · `#downloads` |
| `news.html` | News list (placeholder posts) |
| `contact.html` | Contact details, map, enquiry form |
| `404.html` | Not-found page |

Shared header / nav / footer markup is duplicated in each page (keeps it dependency-free
and SEO-friendly). If you edit the nav or footer, change it in every `*.html` file.

## Assets

```
assets/
  css/styles.css     all styling + design tokens (top of file)
  js/main.js          nav, scroll reveals, product filter, enquiry form
  img/logo.svg        header logo  ← STAND-IN, replace with official artwork
  img/logo-white.svg  footer logo (reversed) ← STAND-IN
  img/favicon.svg     browser-tab icon ← STAND-IN
```

---

## ⚠️ Content that still needs YOUR input

Search the HTML for `PLACEHOLDER` and `20XX` — every spot is marked. Summary:

### 1. About-page copy is a placeholder — and there's a mismatch to resolve
The "use cases" text you supplied for the About section (production allocation,
hydrocarbon accounting, emissions management, measurement & reporting, data migration,
post-M&A integration) is the marketing copy of **energysys.com**, a *UK oil-&-gas
accounting software company* — unrelated to a wind turbine parts business. Every other
part of your brief (services, part categories, the reference site, the "Windfully"
tagline) is wind-turbine parts. So `about.html` currently uses **placeholder copy written
for the parts business**. Tell me which is correct and I'll rewrite it.

### 2. Facts to fill in
- Founding year + milestones — `about.html` timeline (all shown as `20XX`)
- Plant / workshop details, headcount, machine list — `about.html`
- **Client logo grid — DROP IN THE 15 LOGO FILES.**
  A bordered logo grid is on the homepage (compact, under the hero) and on
  `resources.html#clients` (large cells, like the reference site's clients section). Both
  list the same 15 clients: Tata Power Solar, Sembcorp, NEPC India, Green Infra, Siemens
  Gamesa, Senvion, NSL Power, JSW Energy, Hetero, WindForce, DLRE, Wind World, Vestas, GE,
  Renom.
  - Each cell shows the client's **name as text** until its logo file exists. When a logo
    loads, the CSS hides the name; if the file is missing the `<img>` removes itself and
    the name stays. So the grid is fine now and fills in as you add files.
  - **Save the logo files into `assets/img/clients/`** with these exact names — nothing
    else to edit:
    `tata-power-solar.png`, `sembcorp.png`, `nepc-india.png`, `green-infra.png`,
    `siemens-gamesa.png`, `senvion.png`, `nsl-power.png`, `jsw-energy.png`, `hetero.png`,
    `windforce.png`, `dlre.png`, `wind-world.png`, `vestas.png`, `ge.png`, `renom.png`.
  - **PNG with a transparent background looks best.** A logo saved with a solid rectangle
    background (e.g. the grey Vestas one) will show that rectangle in its cell — crop or
    get a transparent version if you can. SVG also works: change the extension in the
    `<img src>` in both `index.html` and `resources.html`.
  - Logos auto-size (≤38px tall on the homepage, ≤52px on Resources), render greyscale,
    and go full-colour on hover.
  - Keep the two lists identical. Confirm you have permission to display each mark before
    publishing.
- ISO certificate numbers, issuing body, dates — `resources.html#quality`
- Open job roles — `resources.html#careers`
- Real news items (headline, date, body) — `news.html`
- The 19 catalogue parts are **realistic placeholders**. Send the real part list
  (code · category · one-line spec) and I'll swap them in.

### 3. Contact details
- **Phone:** `+91 99402 47490`.
- **Email:** `rds@esys.co.in`.
- **Address:** `EnergySYS, New#50, Old#224, Nethaji Road, PN Palayam, Coimbatore – 641037,
  Tamil Nadu, India`. GSTIN `33ANRPB6231A1ZK` and the landmark ("Opp to Cotton Concept")
  are shown on `contact.html`'s detailed address block only.
- **Company name:** shown as "EnergySYS · a Twintronics enterprise". Adjust if the legal
  entity should read differently.
- **Map:** the embed points at "Nethaji Road, PN Palayam, Coimbatore" generically. Replace
  the `iframe src` in `contact.html` with a precise Google Maps "Embed a map" link for the
  exact pin.
- **Social:** LinkedIn / YouTube icons link to `#`. Add real URLs (topbar + footer).

### 4. Logo
`assets/img/logo.svg`, `logo-white.svg` and `favicon.svg` are **hand-built stand-ins**
approximating the mark you shared. Replace them with the official vector artwork, keeping
the same filenames. If you only have a PNG, save it as `logo.png` and update the
`<img src>` in every page's header + footer.

### 5. Enquiry form
`contact.html`'s form is not yet connected to a backend. Two options:
- **Formspree (easiest):** create a form at formspree.io, then replace
  `action="https://formspree.io/f/REPLACE_WITH_YOUR_ID"` with your form URL.
- **Netlify:** add `netlify` and `name="enquiry"` attributes to the `<form>` tag.

Until then, submitting opens the visitor's email client with the details pre-filled to
`rds@esys.co.in` (fallback handled in `main.js`).

### 6. Downloads
`resources.html#downloads` links are placeholders. Put real PDFs in `assets/docs/` and
point each `href` at them (company brochure, product catalogue, ISO certificates).

### 7. Legal pages
Footer links to Terms / Privacy / Cancellation & refund are `#`. Add real pages if needed.

---

## Design tokens

All colours, type and spacing live as CSS custom properties at the top of
`assets/css/styles.css`:

- **Turbine Green** `#00A24C` — primary (nav, links, accents)
- **Deep Spruce** `#04361F` — ink / dark sections
- **Signal Orange** `#F26A1B` — the one loud call-to-action colour
- **Blade White** `#FBFBF8` — page background
- Type: **Space Grotesk** (display) · **Archivo** (body) · **IBM Plex Mono** (part codes,
  labels) — loaded from Google Fonts with system fallbacks.

Change a value once at `:root` and it updates everywhere.

## Photography, video hero & motion

Added in `assets/css/enhance.css` + `assets/js/motion.js` (loaded on every marketing
page after the base files). Additive — nothing in the original stylesheet was removed.

- **Video hero** (`index.html`): full-bleed looping clip, `assets/video/turbine-hero.webm`
  (658 KB) with `turbine-hero.mp4` (2 MB) fallback and `turbine-hero-poster.jpg`. Muted,
  `playsinline`, auto-pauses when off-screen or the tab is hidden. With
  `prefers-reduced-motion` it never plays — the poster shows instead.
- **Photos**: 4 turbine shots, each exported by PIL to 800 / 1200 / 1920 px JPG **and**
  WebP in `assets/img/photos/` (`wind-hills`, `wind-sunset`, `wind-fog`, `wind-aerial`).
  Used as `<picture>` backgrounds in the homepage photo band, the CTA band, the About
  mid-page band, and every inner-page header (`.page-head--photo`). Natural colour, light
  green scrim for legibility.
- **Motion**: hero load sequence, count-up stat numbers, parallax drift on every
  background image (`[data-parallax]`), and image "wipe" reveals (`.reveal-mask`). All
  disabled under `prefers-reduced-motion`.

### Re-encoding the video

The 82 MB source is in `assets/_source/` (git-ignored — safe to delete once you're happy).
There's no system `ffmpeg`; a static one was pulled in via `pip install imageio-ffmpeg`.
To regenerate `assets/video/turbine-hero.*` from a new source:

```bash
FF=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
"$FF" -ss 8 -t 14 -i SOURCE.mp4 -vf "scale=1920:1080:flags=lanczos,fps=25" \
  -c:v libx264 -crf 26 -preset slow -an -pix_fmt yuv420p -movflags +faststart \
  assets/video/turbine-hero.mp4
"$FF" -ss 8 -t 14 -i SOURCE.mp4 -vf "scale=1920:1080:flags=lanczos,fps=25" \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -an assets/video/turbine-hero.webm
"$FF" -ss 8 -i SOURCE.mp4 -frames:v 1 -vf "scale=1600:-2" -q:v 4 \
  assets/video/turbine-hero-poster.jpg
```

Regenerate the photo sizes by re-running the PIL snippet against files in `assets/_source/`.
