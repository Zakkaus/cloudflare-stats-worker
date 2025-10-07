#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';

const HOST = process.env.STATS_HOST || 'https://stats.zakk.au';
const paths = [
  '/api/stats',
  '/api/daily?days=7',
  '/api/top?limit=5',
  '/health'
];

async function fetchJson(path) {
  const url = new URL(path, HOST);
  url.searchParams.set('t', Date.now().toString());
  const res = await fetch(url, {
    headers: { 'User-Agent': 'stats-check/1.0' }
  });
  if (!res.ok) {
    throw new Error(`${url.href} -> HTTP ${res.status}`);
  }
  return res.json();
}

function formatSection(title) {
  const line = '-'.repeat(title.length + 4);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

(async () => {
  console.log(`Cloudflare Stats Worker quick check (target: ${HOST})`);
  for (const path of paths) {
    formatSection(path);
    try {
      const data = await fetchJson(path);
      console.dir(data, { depth: null, colors: true });
    } catch (error) {
      console.error('  ✗ error:', error.message);
    }
    await delay(150);
  }
  console.log('\nDone.');
})();
