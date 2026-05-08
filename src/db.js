import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.data.dbPath), { recursive: true });

export const db = new Database(config.data.dbPath);
db.pragma("journal_mode = WAL");
sqliteVec.load(db);

const dim = config.openai.embeddingDimensions;

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relpath TEXT NOT NULL UNIQUE,
    abspath TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    hash TEXT NOT NULL,
    processed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
`);

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
    embedding FLOAT[${dim}]
  );
`);

export default db;
