import express, { Request, Response } from "express";
import path from "path";
import { loginToLMS } from "./automation";
import { generateDailyDigest } from "./ai";
import { startScheduler, checkDeadlines } from "./scheduler";
import { readDB } from "./db";
import OpenAI from "openai";
import { marked } from "marked";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 3000;

// Start background cron job
startScheduler();

// In-memory chat history (for a real app, store this in DB per user session)
let chatHistory: any[] = [];
let lmsContext = "";

// Serve static UI files
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

// Scrape and setup initial context
app.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password." });
  }

  try {
    lmsContext = await loginToLMS(username, password);
    const markdownDigest = await generateDailyDigest(lmsContext);
    const htmlDigest = await marked.parse(markdownDigest);
    
    // Check deadlines immediately after scraping to populate alerts if any
    checkDeadlines();

    // Reset chat history with system context
    const currentDate = new Date().toDateString();
    chatHistory = [
      { 
        role: "system", 
        content: `You are Campus Copilot, an AI assistant for a student at VIT. Today is ${currentDate}.
Use the following scraped LMS data to answer the student's questions concisely. 
CRUCIAL RULES:
1. When asked about deadlines or generating summaries, ONLY mention deadlines that are UPCOMING (in the future) or missed STRICTLY within the past 7 days.
2. Be prepared to answer questions about past courses as well as current ones. Use your best judgement based on dates to infer if a course is current or past.

Scraped Data:
${lmsContext}` 
      }
    ];

    res.json({ success: true, digest: htmlDigest });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Chat endpoint
app.post("/chat", async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Empty message" });

  chatHistory.push({ role: "user", content: message });

  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: chatHistory,
    });

    const reply = response.choices[0]?.message?.content || "Sorry, I couldn't understand that.";
    chatHistory.push({ role: "assistant", content: reply });
    
    const htmlReply = await marked.parse(reply);
    res.json({ success: true, reply: htmlReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Fetch active alerts
app.get("/reminders", (req: Request, res: Response) => {
  const db = readDB();
  res.json({ success: true, alerts: db.alerts });
});

app.listen(PORT, () => {
  console.log(`🚀 Campus Copilot UI running at http://localhost:${PORT}`);
});
