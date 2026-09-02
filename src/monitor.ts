import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { processScrape } from './notify/diff';
import { formatAlerts } from './notify/format';
import { createChannelFromEnv } from './notify/channels';
import { MonitorState, ScrapeOutput } from './notify/types';

dotenv.config();

const SCRAPER_SERVICE_URL = (process.env.SCRAPER_SERVICE_URL || 'http://localhost:10000').replace(/\/+$/, '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const SCRAPER_TIMEOUT_MS = 240_000;
const STATE_FILE = path.resolve(process.env.MONITOR_STATE_FILE || path.join(__dirname, '..', 'data', 'state.json'));
const DEADLINE_WARN_HOURS = Number(process.env.DEADLINE_WARN_HOURS || 24);
const DRY_RUN = process.argv.includes('--dry-run');

async function runScrape(): Promise<ScrapeOutput> {
  const username = process.env.VIT_USERNAME;
  const password = process.env.VIT_PASSWORD;
  if (!username || !password) {
    throw new Error('VIT_USERNAME and VIT_PASSWORD environment variables are required.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);
  try {
    const response = await fetch(`${SCRAPER_SERVICE_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY
      },
      body: JSON.stringify({ username: username.trim(), password, lmsUrl: 'https://lms.vit.ac.in/login/index.php' }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error || `Scraper service returned HTTP ${response.status}`);
    }
    return body as ScrapeOutput;
  } finally {
    clearTimeout(timeoutId);
  }
}

function loadState(): MonitorState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    // Corrupt state must fail loudly instead of silently re-baselining.
    throw new Error(`State file ${STATE_FILE} is unreadable or corrupt: ${err.message}`);
  }
}

async function main(): Promise<void> {
  const scrapeResult = await runScrape();
  const previous = loadState();
  const now = new Date();

  const { alerts, state } = processScrape(previous, scrapeResult, now, DEADLINE_WARN_HOURS);
  const message = formatAlerts(alerts);

  if (previous === null) {
    console.log('First run: saving baseline snapshot (existing assignments are not alerted).');
  }

  if (message) {
    if (DRY_RUN) {
      console.log('--- DRY RUN: alerts that would be sent ---');
      console.log(message);
    } else {
      const channel = createChannelFromEnv();
      await channel.send(message);
      console.log(`Sent ${alerts.length} alert(s) via ${channel.name}.`);
    }
  } else {
    console.log('No changes detected.');
  }

  if (DRY_RUN) {
    console.log('Dry run: state file not updated.');
    return;
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`State saved to ${STATE_FILE}.`);
}

main().catch(err => {
  console.error('Monitor run failed:', err.message || err);
  process.exit(1);
});
