import OpenAI from "openai";
import { VISION_SYSTEM_PROMPT } from "@/lib/prompts";

// OpenAI-compatible vision client. Reads a screenshot into structured text.
function client(): OpenAI {
  const apiKey = process.env.VISION_API_KEY;
  if (!apiKey) throw new Error("VISION_API_KEY is not set.");
  return new OpenAI({
    apiKey,
    baseURL: process.env.VISION_BASE_URL || "https://api.openai.com/v1",
  });
}

export interface VisionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

// imageDataUrl: a data URL ("data:image/png;base64,....") of the screenshot.
export async function readScreenshot(imageDataUrl: string): Promise<VisionResult> {
  const model = process.env.VISION_MODEL || "gpt-4o";
  const openai = client();

  const resp = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: VISION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe and describe this CTF screen accurately." },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 1500,
  });

  const text = resp.choices[0]?.message?.content?.trim() || "(no text read)";
  return {
    text,
    tokensIn: resp.usage?.prompt_tokens ?? 0,
    tokensOut: resp.usage?.completion_tokens ?? 0,
  };
}
