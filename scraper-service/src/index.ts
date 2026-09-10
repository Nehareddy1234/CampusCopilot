import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { loginToLMS } from './automation';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '250kb' }));
app.disable('x-powered-by');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Render Health Check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'campus-copilot-scraper', timestamp: new Date().toISOString() });
});

// Middleware for shared-secret authorization
function requireInternalAuth(req: Request, res: Response, next: express.NextFunction) {
  const providedKey = req.headers['x-internal-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (!INTERNAL_API_KEY || providedKey !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing internal API key.' });
  }
  next();
}

// Concurrency Queue: Instead of rejecting with 429, queue requests sequentially
let queue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (queue.length > 0) {
    const job = queue.shift();
    if (job) {
      try {
        await job();
      } catch (err) {
        console.error('Error executing queued scrape job:', err);
      }
    }
  }

  isProcessingQueue = false;
}

function enqueueScrape<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    processQueue();
  });
}

// Scrape endpoint with auto-queuing (No 429 rate limits)
app.post('/scrape', requireInternalAuth, async (req: Request, res: Response) => {
  const { username, password, lmsUrl } = req.body || {};

  let validatedLmsUrl: URL;
  try {
    validatedLmsUrl = new URL(typeof lmsUrl === 'string' && lmsUrl ? lmsUrl : 'https://lms.vit.ac.in/login/index.php');
  } catch {
    return res.status(400).json({ error: 'Enter a valid LMS website address.' });
  }

  if (validatedLmsUrl.protocol !== 'https:' || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'A secure LMS URL and LMS credentials are required.' });
  }

  try {
    const result = await enqueueScrape(() => 
      loginToLMS(username.trim(), password, validatedLmsUrl.toString())
    );

    res.json({
      records: result.records,
      assignments: result.assignments,
      courses: result.courses,
      userId: result.userId,
      allowlist: result.allowlist
    });
  } catch (error) {
    const message = (error as Error).message || 'Scraping failed';
    console.error('Scraping error:', message);
    
    if (message.toLowerCase().includes('credential') || message.toLowerCase().includes('login') || message.toLowerCase().includes('password')) {
      return res.status(400).json({ error: message });
    }
    
    res.status(502).json({
      error: 'Unable to connect to LMS or perform scraping.'
    });
  }
});

// 404 Fallback
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Scraper microservice listening on http://${HOST}:${PORT}`);
});
