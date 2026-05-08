import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, "..", "config.json");

if (!fs.existsSync(configPath)) {
  throw new Error(`config.json not found at ${configPath}`);
}

const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

function req(obj, dotPath) {
  const parts = dotPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || cur[p] === undefined) {
      throw new Error(`Missing required config: ${dotPath}`);
    }
    cur = cur[p];
  }
  return cur;
}

req(raw, "openai.baseUrl");
req(raw, "openai.apiKey");
req(raw, "openai.embeddingModel");
req(raw, "openai.embeddingDimensions");
req(raw, "openai.embeddingTokenLimit");
req(raw, "openai.chatModel");
req(raw, "data.markdownFolder");
req(raw, "data.dbPath");

const projectRoot = path.resolve(__dirname, "..");
raw.data.markdownFolder = path.resolve(projectRoot, raw.data.markdownFolder);
raw.data.dbPath = path.resolve(projectRoot, raw.data.dbPath);

export const config = raw;
export default config;
