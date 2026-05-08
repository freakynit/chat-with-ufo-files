# Chat with UFO Files — May 2026

A minimal, API-driven Retrieval-Augmented Generation system over markdown files, with a built-in single-page web UI. Drop in your `.md` files, point it at an OpenAI-compatible endpoint, and start asking questions — complete with inline citations and direct download links to the source documents.

- **Storage:** SQLite + [`sqlite-vec`](https://github.com/asg017/sqlite-vec) (vec0 virtual table)
- **Embeddings & Chat:** any OpenAI-compatible endpoint (e.g. OpenRouter)
- **Concurrency:** [`p-limit`](https://www.npmjs.com/package/p-limit)
- **HTTP:** Express
- **Frontend:** single-page UI (Tailwind CSS, no framework) served at `/`
- **Module system:** ESM (`"type": "module"`)
- **Citations:** every match returns the chunk text + a direct download URL to the original markdown file. The `/api/ask` answer is grounded in those chunks.

> 100% Claude generated. Works super well. With citations and downloadable links to original source documents.

> **Ready to go** — this repo ships with all UFO files already indexed and the SQLite database pre-built. Just set your API key, run `npm start`, and open `http://localhost:3000`.

## Install

```bash
git clone git@github.com:freakynit/chat-with-ufo-files.git
cd chat-with-ufo-files
npm install
```

## Configure

Edit `config.json`:

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "publicBaseUrl": "http://localhost:3000"
  },
  "data": {
    "markdownFolder": "./data",
    "dbPath": "./rag.db"
  },
  "openai": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": "YOUR_OPENROUTER_KEY",
    "embeddingModel": "perplexity/pplx-embed-v1-0.6b",
    "embeddingDimensions": 1024,
    "embeddingTokenLimit": 6000,
    "chatModel": "deepseek/deepseek-v4-flash"
  },
  "chunking": { "overlapWords": 500 },
  "retrieval": { "topK": 5 },
  "concurrency": { "embeddings": 5 },
  "retries": { "maxAttempts": 4, "initialDelayMs": 500 }
}
```

| Key | Meaning |
| --- | --- |
| `openai.baseUrl` | OpenAI-compatible base URL (OpenRouter by default). |
| `openai.apiKey` | API key sent as `Authorization: Bearer ...`. |
| `openai.embeddingModel` | Model used for `/embeddings`. |
| `openai.embeddingDimensions` | Vector size; must match the model. The vec0 table is created with this dimension. |
| `openai.embeddingTokenLimit` | Max tokens per embedding call. Inputs larger than this are chunked. |
| `openai.chatModel` | Model used for the final answer in `/api/ask`. |
| `chunking.overlapWords` | Sliding-window overlap (words) when chunking long files. Default per spec: **500**. |
| `retrieval.topK` | Default number of matches returned. |
| `concurrency.embeddings` | Max in-flight embedding calls (also caps file-level parallelism). |
| `retries.maxAttempts` / `initialDelayMs` | Exponential backoff on embed/chat failures. |
| `data.markdownFolder` | Folder scanned recursively for `.md` / `.markdown` files. |
| `data.dbPath` | SQLite database file (created if missing). |

## Run

Drop `.md` files into `data/` (or whichever folder you configured), then:

```bash
npm start
```

On startup the server:
1. Creates the SQLite schema if not present (idempotent).
2. Loads `sqlite-vec` and creates the `chunk_vectors` vec0 virtual table.
3. Recursively scans the markdown folder. Each file is hashed (SHA-256). **Files whose content hash hasn't changed since last ingest are skipped** — re-running does no extra work. Modified files are re-embedded; their old chunks/vectors are replaced atomically.
4. Starts the HTTP server.

You can also run ingest standalone:

```bash
npm run ingest
```

## Web UI

Once the server is running, open **`http://localhost:3000`** in your browser.

The UI has two modes:

| Mode | What it does |
| --- | --- |
| **Search** | Pure vector search — returns the top-k most relevant chunks from your documents, each with a distance score and a download button for the source file. |
| **Ask** | Full RAG — retrieves the top-k chunks, sends them as context to the chat model, and renders the grounded answer with inline citations (`[1]`, `[2]` …) in a markdown viewer. |

**Controls:**
- `Top K results` — how many chunks to retrieve (capped at `retrieval.topK` from `config.json`).
- `Ctrl+Enter` / `Cmd+Enter` — submit without reaching for the mouse.
- Each result card shows the source file path, distance score, chunk index, and a **Download** button to grab the original markdown file.

## API

### `POST /api/search`

Pure vector search. Returns top-k matching chunks with download links.

```bash
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"how does retry work?","topK":5}'
```

Response:

```json
{
  "query": "how does retry work?",
  "matches": [
    {
      "chunkId": 42,
      "chunkIndex": 1,
      "distance": 0.18,
      "text": "...the relevant chunk text...",
      "file": {
        "relpath": "guides/networking.md",
        "downloadUrl": "http://localhost:3000/files/guides/networking.md"
      }
    }
  ]
}
```

### `POST /api/ask`

Retrieves top-k chunks, sends them as context to the chat model, and returns the grounded answer alongside the citations.

```bash
curl -X POST http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"query":"summarize the retry policy","topK":5}'
```

Response:

```json
{
  "query": "summarize the retry policy",
  "answer": "The retry policy uses exponential backoff... [1][2]\n\nSources:\n- guides/networking.md — http://localhost:3000/files/guides/networking.md",
  "matches": [ /* same shape as /api/search */ ]
}
```

The system prompt instructs the model to:
- Answer **only** from the provided context.
- Cite numbered sources inline (`[1]`, `[2]` …).
- Append a `Sources:` block with file paths and download links.
- Say "I don't know" if the context is insufficient.

### `GET /files/<relpath>`

Static download of the original markdown file (served from `data.markdownFolder`). This is the URL referenced by every match's `file.downloadUrl`.

## How chunking works

1. Each markdown file is read as UTF-8.
2. Word count is estimated; if `words * 1.3 ≤ embeddingTokenLimit` the whole file is one chunk.
3. Otherwise we slide a window of `floor(0.9 * tokenLimit / 1.3)` words with `overlapWords` (default 500) overlap, per the spec.
4. Each chunk is embedded concurrently (capped by `concurrency.embeddings`) with retry/backoff.
5. Chunks + vectors are written in a single SQLite transaction per file, so partial failures don't leave orphans.

## Schema (auto-created, idempotent)

```sql
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relpath TEXT UNIQUE,
  abspath TEXT,
  size INTEGER,
  mtime INTEGER,
  hash TEXT,                 -- sha256 of file contents; used to skip unchanged files
  processed_at INTEGER
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER,
  text TEXT
);

CREATE VIRTUAL TABLE chunk_vectors USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[<embeddingDimensions>]
);
```

KNN query:

```sql
SELECT chunk_id, distance
FROM chunk_vectors
WHERE embedding MATCH ? AND k = ?
ORDER BY distance;
```

## Notes

- `sqlite-vec` is loaded as a runtime extension via `better-sqlite3`. No native build step beyond `npm install`.
- Token estimation is a simple heuristic (`1.3 tokens/word`). If your model has stricter limits, lower `embeddingTokenLimit` accordingly — the chunker will adapt.
- Re-running `npm start` after a stop is safe: the schema is created with `IF NOT EXISTS`, and unchanged files are skipped via content hash.

## License

MIT © 2026

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
