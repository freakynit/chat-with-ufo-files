import { config } from "./config.js";

// Rough token estimate: ~1.3 tokens/word for English. Caller passes word array.
// We chunk if estimated tokens exceed embeddingTokenLimit.
const TOKENS_PER_WORD = 1.3;

export function chunkText(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const tokenLimit = config.openai.embeddingTokenLimit;
  const overlap = config.chunking.overlapWords;

  const estTokens = words.length * TOKENS_PER_WORD;
  if (estTokens <= tokenLimit) {
    return [text.trim()];
  }

  // Words per chunk so estimated tokens fit comfortably (90% headroom).
  const wordsPerChunk = Math.max(
    overlap + 1,
    Math.floor((tokenLimit * 0.9) / TOKENS_PER_WORD)
  );
  const step = Math.max(1, wordsPerChunk - overlap);

  const chunks = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + wordsPerChunk);
    if (slice.length === 0) break;
    chunks.push(slice.join(" "));
    if (i + wordsPerChunk >= words.length) break;
  }
  return chunks;
}
