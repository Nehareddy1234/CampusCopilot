import OpenAI from "openai";

export async function generateDailyDigest(scrapedData: string, apiKey: string): Promise<string> {
  const currentDate = new Date().toDateString();
  const systemPrompt = `You are Campus Copilot, an AI assistant for a student at VIT. 
I am going to provide you with raw scraped data from my LMS dashboard. This data may include a mix of past and current courses, as well as their assignments.

Today's date is: ${currentDate}.

Please generate a "Daily Digest" for me in clean Markdown.
It should include:
1. A brief, encouraging greeting.
2. A prioritized list of UPCOMING deadlines only. Never mention a past deadline.
3. A concise summary of the active courses in the input.
Do not describe an assignment as upcoming unless the input includes its explicit Due line.

If there are no valid assignments matching the strict deadline rule, just say "Looks like you have no immediate assignments. Enjoy your day!"
`;

  try {
    const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey });
    const response = await client.chat.completions.create({
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
