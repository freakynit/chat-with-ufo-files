import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { config } from "./config.js";
import { db } from "./db.js";
import { chunkText } from "./chunker.js";
import { embed } from "./openai.js";

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      yield full;
    }
  }
}

function fileHash(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const selectFile = db.prepare("SELECT id, hash FROM files WHERE relpath = ?");
const insertFile = db.prepare(
  "INSERT INTO files (relpath, abspath, size, mtime, hash, processed_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const updateFile = db.prepare(
  "UPDATE files SET abspath = ?, size = ?, mtime = ?, hash = ?, processed_at = ? WHERE id = ?"
);
const deleteChunksByFile = db.prepare("DELETE FROM chunks WHERE file_id = ?");
const deleteVectorsByChunkIds = db.prepare(
  "DELETE FROM chunk_vectors WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)"
);
const insertChunk = db.prepare(
  "INSERT INTO chunks (file_id, chunk_index, text) VALUES (?, ?, ?)"
);
const insertVector = db.prepare(
  "INSERT INTO chunk_vectors (rowid, embedding) VALUES (?, ?)"
);

async function processFile(absPath, relPath) {
  const stat = fs.statSync(absPath);
  const buf = fs.readFileSync(absPath);
  const hash = fileHash(buf);

  const existing = selectFile.get(relPath);
  if (existing && existing.hash === hash) {
    return { relPath, status: "skipped" };
  }

  const text = buf.toString("utf-8");
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { relPath, status: "empty" };
  }

  // Embed all chunks for this file with concurrency.
  const limit = pLimit(config.concurrency.embeddings);
  const embeddings = await Promise.all(
    chunks.map((chunk) => limit(() => embed(chunk)))
  );

  // Validate dimensions.
  const expectedDim = config.openai.embeddingDimensions;
  for (const v of embeddings) {
    if (v.length !== expectedDim) {
      throw new Error(
        `embedding dim mismatch for ${relPath}: expected ${expectedDim}, got ${v.length}`
      );
    }
  }

  // Atomic write per file.
  const tx = db.transaction(() => {
    let fileId;
    const now = Date.now();
    if (existing) {
      deleteVectorsByChunkIds.run(existing.id);
      deleteChunksByFile.run(existing.id);
      updateFile.run(absPath, stat.size, stat.mtimeMs | 0, hash, now, existing.id);
      fileId = Number(existing.id);
    } else {
      const info = insertFile.run(
        relPath,
        absPath,
        stat.size,
        stat.mtimeMs | 0,
        hash,
        now
      );
      fileId = Number(info.lastInsertRowid);
    }
    for (let i = 0; i < chunks.length; i++) {
      const chunkInfo = insertChunk.run(fileId, i, chunks[i]);
      // vec0 requires the rowid to bind as SQLITE_INTEGER. better-sqlite3
      // binds JS numbers as REAL, so wrap in BigInt.
      const chunkId = BigInt(chunkInfo.lastInsertRowid);
      const f32 = new Float32Array(embeddings[i]);
      insertVector.run(chunkId, Buffer.from(f32.buffer));
    }
  });
  tx();

  return { relPath, status: existing ? "updated" : "added", chunks: chunks.length };
}

export async function ingestAll() {
  const folder = config.data.markdownFolder;
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
    console.log(`Created empty markdown folder: ${folder}`);
    return;
  }

  const files = [...walk(folder)];
  if (files.length === 0) {
    console.log(`No markdown files in ${folder}`);
    return;
  }

  console.log(`Found ${files.length} markdown files. Processing...`);

  // p-limit at file level too (concurrency from same setting).
  const fileLimit = pLimit(config.concurrency.embeddings);
  const results = await Promise.all(
    files.map((abs) =>
      fileLimit(async () => {
        const rel = path.relative(folder, abs);
        try {
          const r = await processFile(abs, rel);
          console.log(`  [${r.status}] ${rel}${r.chunks ? ` (${r.chunks} chunks)` : ""}`);
          return r;
        } catch (err) {
          console.error(`  [error] ${rel}: ${err.message}`);
          return { relPath: rel, status: "error", error: err.message };
        }
      })
    )
  );
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log("Ingest summary:", counts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestAll().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
