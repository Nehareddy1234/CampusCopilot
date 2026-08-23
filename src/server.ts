import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { loginToLMS } from './automation';
import { generateDailyDigest } from './ai';

dotenv.config();

const app = express();
app.use(cors());
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_SIZE = '250kb';
const requestTimes = new Map<string, number[]>();

app.disable('x-powered-by');

// Serve the static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: MAX_BODY_SIZE }));

// Handle JSON parsing errors specifically
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    next(err);
});

// Required to serve index.html directly when hitting the root URL if static routing fails
app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const SERVER_API_KEY = process.env.OPENROUTER_API_KEY || '';

function allowRequest(req: Request, res: Response): boolean {
  const key = req.ip || 'local';
  const now = Date.now();
  const recent = (requestTimes.get(key) || []).filter(time => now - time < 60_000);
  if (recent.length >= 10) {
    res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    return false;
  }
  recent.push(now);
  requestTimes.set(key, recent);
  return true;
}

app.post('/login', async (req: Request, res: Response) => {
  if (!allowRequest(req, res)) return;
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
    const result = await loginToLMS(username.trim(), password, validatedLmsUrl.toString());
    const filteredRecords = result.records.filter(r => r.userId === result.userId);
    const digestContext = JSON.stringify(filteredRecords);
    const digest = await generateDailyDigest(digestContext, SERVER_API_KEY);
    // Do not retain credentials, API keys, assignments, or chat state on the server.
    res.json({ success: true, digest, records: result.records, userId: result.userId, allowlist: result.allowlist, assignments: result.assignments, courses: result.courses });
  } catch (error) {
    const message = (error as Error).message;
    console.error('LMS login failed:', message);
    res.status(502).json({ error: message.startsWith('LMS login failed') ? message : 'Unable to connect to LMS or generate the digest.' });
  }
});

app.post('/chat', async (req: Request, res: Response) => {
  if (!allowRequest(req, res)) return;
  const { message, records, userId, history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 2_000 || !Array.isArray(records) || userId === undefined) {
    return res.status(400).json({ error: 'Invalid chat request.' });
  }

  // Filter records dynamically based on active user id
  const filteredRecords = records.filter(r => r.userId === userId);
  const context = JSON.stringify(filteredRecords);

  const safeHistory = Array.isArray(history)
    ? history.slice(-10).filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.length <= 4_000)
    : [];
  const currentDate = new Date().toDateString();
  const system = `You are an intelligent, precise academic assistant chatbot. Your goal is to provide clear, actionable summaries about the user's Moodle courses, assignments, and deadlines.

Today is ${currentDate}.

Formatting Instructions:
- Always use bold text (**bold**) for course names, assignment titles, due dates, and status keywords.
- Minimize conversational fluff; answer the user's question directly in sentence 1.
- Use bullet points to list items cleanly.
- Keep responses compact, high-density, and structured for quick scanning.

Handling Missing Data gracefully:
If an assignment or course list is incomplete in the context, do not write generic apologies. State exactly what is currently indexed (e.g., "Found 3 assignments for BCSE432E in the database...").

Example Output Format:
You have **2 active courses** this semester:

- **Reinforcement Learning (BCSE432E)** — 1 pending assignment
- **Data Structures (CS101)** — All assignments submitted

Upcoming Deadlines:
- **Assignment 2: Policy Gradients** | Course: **BCSE432E** | Due: **Tomorrow, 11:59 PM**

Context:
${context}`;

  try {
    const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: SERVER_API_KEY });
    const response = await client.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: system }, ...safeHistory, { role: 'user', content: message.trim() }]
    });
    res.json({ success: true, reply: response.choices[0]?.message?.content || 'I could not generate a response.' });
  } catch (error) {
    console.error('Chat request failed:', (error as Error).message);
    res.status(502).json({ error: 'The AI provider rejected the request. Check your API key and balance.' });
  }
});

// Handle 404 for non-existent API routes or fallback to index.html for frontend routing
app.use((req: Request, res: Response) => {
  if (req.method === 'POST' || req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Endpoint not found' });
  } else {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

// Global error handler for unhandled exceptions to return JSON
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Campus Copilot is running at http://localhost:${PORT}`));
