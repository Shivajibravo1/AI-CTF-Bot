import OpenAI from "openai";
import { REASON_SYSTEM_PROMPT, reframeForRetry } from "@/lib/prompts";
import type { MessageRow, RoomState } from "@/lib/types";

// OpenAI-compatible reasoning client. Model-agnostic: point REASON_BASE_URL at
// a hosted WhiteRabbitNeo/DeepHat API or your own vLLM server.
function client(): OpenAI {
  const apiKey = process.env.REASON_API_KEY;
  const baseURL = process.env.REASON_BASE_URL;
  if (!baseURL) throw new Error("REASON_BASE_URL is not set.");
  return new OpenAI({
    apiKey: apiKey || "not-needed", // some self-hosted servers ignore the key
    baseURL,
  });
}

// Heuristic: did the model refuse? Used to trigger one reframe-retry.
function looksLikeRefusal(text: string): boolean {
  const t = text.toLowerCase();
  const signals = [
    "i can't help", "i cannot help", "i can't assist", "i cannot assist",
    "i'm not able to", "i am not able to", "i won't", "i will not",
    "cannot provide", "can't provide", "not appropriate", "unable to help",
    "against my", "i'm sorry, but",
  ];
  return signals.some((s) => t.includes(s)) && text.length < 600;
}

function buildContext(state: RoomState, history: MessageRow[]): string {
  const parts: string[] = [];
  if (state && Object.keys(state).length) {
    parts.push("Known room state so far:\n" + JSON.stringify(state, null, 2));
  }
  if (history.length) {
    const recent = history.slice(-12).map((m) => `[${m.role}] ${m.content}`).join("\n\n");
    parts.push("Recent conversation:\n" + recent);
  }
  return parts.join("\n\n");
}

export interface ReasonResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  retried: boolean;
}

// Streaming reasoning call. Returns an async iterator of text chunks plus a
// promise that resolves to the final result (with usage + retry flag).
export async function reasonStream(
  question: string,
  state: RoomState,
  history: MessageRow[]
): Promise<{ stream: AsyncIterable<string>; done: Promise<ReasonResult> }> {
  const model = process.env.REASON_MODEL || "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B";
  const openai = client();
  const context = buildContext(state, history);

  const userContent = context
    ? `${context}\n\nOperator question:\n${question}`
    : question;

  let resolveDone!: (r: ReasonResult) => void;
  const done = new Promise<ReasonResult>((res) => (resolveDone = res));

  async function* generate(): AsyncIterable<string> {
    let full = "";
    let tokensIn = 0;
    let tokensOut = 0;

    const first = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: REASON_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 1800,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of first) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        yield delta;
      }
      if (chunk.usage) {
        tokensIn += chunk.usage.prompt_tokens ?? 0;
        tokensOut += chunk.usage.completion_tokens ?? 0;
      }
    }

    // One automatic reframe-retry if the model balked.
    if (looksLikeRefusal(full)) {
      yield "\n\n_(reframing as authorized CTF context and retrying...)_\n\n";
      const retry = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: REASON_SYSTEM_PROMPT },
          { role: "user", content: reframeForRetry(userContent) },
        ],
        temperature: 0.3,
        max_tokens: 1800,
        stream: true,
        stream_options: { include_usage: true },
      });
      let retryFull = "";
      for await (const chunk of retry) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          retryFull += delta;
          yield delta;
        }
        if (chunk.usage) {
          tokensIn += chunk.usage.prompt_tokens ?? 0;
          tokensOut += chunk.usage.completion_tokens ?? 0;
        }
      }
      resolveDone({ text: retryFull || full, tokensIn, tokensOut, retried: true });
      return;
    }

    resolveDone({ text: full, tokensIn, tokensOut, retried: false });
  }

  return { stream: generate(), done };
}
