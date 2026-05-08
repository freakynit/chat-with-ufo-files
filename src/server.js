import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import "./db.js";
import { ingestAll } from "./ingest.js";
import { searchChunks } from "./search.js";
import { chat } from "./openai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));

// Frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Static download endpoint for original markdown files.
app.use(
  "/files",
  express.static(config.data.markdownFolder, {
    fallthrough: false,
    dotfiles: "ignore",
    setHeaders: (res, p) => {
      if (p.endsWith(".md") || p.endsWith(".markdown")) {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${path.basename(p)}"`
        );
      }
    },
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

// API 1: search → topK matches with chunk text and download links.
app.post("/api/search", async (req, res) => {
  try {
    const { query, topK } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query (string) is required" });
    }
    const matches = await searchChunks(query, topK);
    res.json({ query, matches });
  } catch (err) {
    console.error("search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// API 2: ask → final answer + matched chunks (with citations).
app.post("/api/ask", async (req, res) => {
  try {
    const { query, topK } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query (string) is required" });
    }
    const matches = await searchChunks(query, topK);

    if (matches.length === 0) {
      return res.json({
        query,
        answer:
          "I don't have any indexed documents to answer this question yet.",
        matches: [],
      });
    }

    const contextBlocks = matches
      .map(
        (m, i) =>
          `[${i + 1}] source: ${m.file.relpath}\nlink: ${m.file.downloadUrl}\n---\n${m.text}`
      )
      .join("\n\n");

    const system = [
      "You are a careful assistant that answers questions strictly using the provided context.",
      "Cite sources inline like [1], [2] referring to the numbered context blocks.",
      "If the context does not contain the answer, say you don't know.",
      "After your answer, include a 'Sources:' list with the markdown file paths and links you used.",
    ].join(" ");

    const user = `Question: ${query}\n\nContext:\n${contextBlocks}`;

    const answer = await chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    res.json({ query, answer, matches });
  } catch (err) {
    console.error("ask error:", err);
    res.status(500).json({ error: err.message });
  }
});

const port = config.server.port;
const host = config.server.host || "0.0.0.0";

(async () => {
  console.log("Starting ingest at boot...");
  try {
    await ingestAll();
  } catch (err) {
    console.error("Ingest failed at boot:", err);
  }
  app.listen(port, host, () => {
    console.log(`RAG server listening on http://${host}:${port}`);
    console.log(`  POST /api/search  { "query": "...", "topK": 5 }`);
    console.log(`  POST /api/ask     { "query": "...", "topK": 5 }`);
    console.log(`  GET  /files/<relative path to markdown>`);
  });
})();
