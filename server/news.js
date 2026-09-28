'use strict';

/**
 * GET /api/news — latest wind-energy headlines from public RSS feeds.
 * Fetched server-side (browsers can't read other sites' feeds because of CORS),
 * cached in memory, and trimmed to headline + link + source + date only.
 */

const express = require('express');
const Parser = require('rss-parser');

const router = express.Router();

const FEEDS = [
  { source: 'Windpower Engineering', url: 'https://www.windpowerengineering.com/feed/' },
  { source: 'Offshore WIND', url: 'https://offshorewind.biz/feed/' },
  { source: 'Wind Daily', url: 'https://winddaily.com/winddaily.xml' },
  { source: 'CleanTechnica', url: 'https://cleantechnica.com/feed/', windOnly: true },
  { source: 'American Clean Power', url: 'https://cleanpower.org/feed/', windOnly: true },
];

// Broad clean-energy feeds also cover EVs, solar, etc.; keep only wind stories.
const WIND_RE = /\b(wind|turbines?|offshore|repower(ing)?|nacelle|blades?)\b/i;

const MAX_ITEMS = 6;
const CACHE_MS = 30 * 60 * 1000;
const FEED_TIMEOUT_MS = 8000;

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnergySYS-NewsBot/1.0)' },
});

let cache = { at: 0, items: [] };
let inflight = null;

function cleanText(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function safeHttpUrl(u) {
  try {
    const p = new URL(String(u || '').trim());
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
  } catch (e) { return null; }
}

async function loadFeed(feed) {
  const data = await parser.parseURL(feed.url);
  return (data.items || []).filter((it) => {
    if (!feed.windOnly) return true;
    const hay = [it.title, (it.categories || []).join(' '), it.contentSnippet].join(' ');
    return WIND_RE.test(hay);
  }).map((it) => {
    const link = safeHttpUrl(it.link);
    const when = new Date(it.isoDate || it.pubDate || '');
    const title = cleanText(it.title);
    if (!link || !title || isNaN(when)) return null;
    return { title, link, source: feed.source, date: when.toISOString() };
  }).filter(Boolean);
}

async function refresh() {
  const results = await Promise.allSettled(FEEDS.map(loadFeed));
  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else console.warn('[news] feed failed:', FEEDS[i].url, '-', (r.reason && r.reason.message) || r.reason);
  });
  if (!items.length) throw new Error('no feed returned items');

  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  const seen = new Set();
  const top = [];
  for (const it of items) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    top.push(it);
    if (top.length === MAX_ITEMS) break;
  }
  cache = { at: Date.now(), items: top };
  return top;
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  if (cache.items.length && Date.now() - cache.at < CACHE_MS) {
    return res.json({ items: cache.items, updatedAt: new Date(cache.at).toISOString() });
  }
  try {
    inflight = inflight || refresh().finally(() => { inflight = null; });
    const items = await inflight;
    return res.json({ items, updatedAt: new Date(cache.at).toISOString() });
  } catch (err) {
    console.error('[news] refresh failed:', err.message);
    if (cache.items.length) {
      return res.json({ items: cache.items, updatedAt: new Date(cache.at).toISOString(), stale: true });
    }
    return res.status(502).json({ items: [], error: 'News is unavailable right now.' });
  }
});

module.exports = router;
