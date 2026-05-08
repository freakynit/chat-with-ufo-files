import { db } from "./db.js";
import { embed } from "./openai.js";
import { config } from "./config.js";

const knnStmt = db.prepare(`
  SELECT v.rowid AS chunk_id, v.distance AS distance,
         c.text AS text, c.chunk_index AS chunk_index,
         f.relpath AS relpath, f.id AS file_id
  FROM chunk_vectors v
  JOIN chunks c ON c.id = v.rowid
  JOIN files f ON f.id = c.file_id
  WHERE v.embedding MATCH ? AND k = ?
  ORDER BY v.distance
`);

export function buildDownloadUrl(relpath) {
  const base = config.server.publicBaseUrl.replace(/\/+$/, "");
  // Encode each segment to keep slashes.
  const encoded = relpath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${base}/files/${encoded}`;
}

export async function searchChunks(query, topK) {
  const maxK = config.retrieval.topK;
  const k = Math.min(topK || maxK, maxK);
  const queryVec = await embed(query);
  const f32 = new Float32Array(queryVec);
  const rows = knnStmt.all(Buffer.from(f32.buffer), k);
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    chunkIndex: r.chunk_index,
    distance: r.distance,
    text: r.text,
    file: {
      relpath: r.relpath,
      downloadUrl: buildDownloadUrl(r.relpath),
    },
  }));
}
