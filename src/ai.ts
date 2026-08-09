import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

export async function generateDailyDigest(scrapedData: string): Promise<string> {
  const currentDate = new Date().toDateString();
  const systemPrompt = `You are Campus Copilot, an AI assistant for a student at VIT. 
I am going to provide you with raw scraped data from my LMS dashboard. This data may include a mix of past and current courses, as well as their assignments.

Today's date is: ${currentDate}.

Please generate a "Daily Digest" for me in clean Markdown.
It should include:
1. A brief, encouraging greeting.
2. A prioritized list of deadlines. CRUCIAL RULE: You must ONLY list deadlines that are UPCOMING (in the future) OR deadlines that were missed STRICTLY within the past 7 days. Do NOT mention any deadlines older than one week.
3. A summary of my current active courses. (Use your best judgement to distinguish current courses from past ones, e.g., based on recent assignment activity or just list them if you're unsure, but keep it concise).

If there are no valid assignments matching the strict deadline rule, just say "Looks like you have no immediate assignments. Enjoy your day!"
`;

  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here is the scraped LMS data:\n\n${scrapedData}` }
      ],
    });

    return response.choices[0]?.message?.content || "Could not generate digest.";
  } catch (error) {
    console.error("AI Error:", error);
    return `Error generating digest: ${(error as Error).message}`;
  }
}
