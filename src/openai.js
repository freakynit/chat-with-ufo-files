import { config } from "./config.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, label) {
  const { maxAttempts, initialDelayMs } = config.retries;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[${label}] attempt ${attempt} failed: ${err.message}. retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export async function embed(text) {
  return withRetry(async () => {
    const res = await fetch(`${config.openai.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.openai.embeddingModel,
        input: text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`embeddings ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const vec = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error("embeddings response missing data[0].embedding");
    }
    return vec;
  }, "embed");
}

export async function chat(messages) {
  return withRetry(async () => {
    const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.openai.chatModel,
        messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`chat ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("chat response missing choices[0].message.content");
    }
    return content;
  }, "chat");
}
