# Research Rover — Architecture & Data Flow (memory doc)

> Quick-reference map of the whole codebase: how data moves, what every page/route
> does, and the non-obvious gotchas. Written so you can re-orient fast without
> re-reading every file.

## 1. Big picture

Research Rover = **FastAPI backend** (`backend/`) + **React/Vite/TS frontend** (`frontend/`).
It searches **PubMed**, saves results to a **CSV** in a shared `data/` folder, then lets you:
- **embed** those papers (full-text scrape → semantic chunks → FAISS index),
- **chat** with them (RAG over the FAISS index via Gemini),
- **analyze** keywords (frequency, co-occurrence, centrality, word cloud, network).

```
Browser (React)
   │  axios → http://localhost:8000/api/v1/...
   ▼
FastAPI (main.py)  routers: search / chat / files / embeddings / analysis
   │
   ├─ SearchService → PubMedService (NCBI E-utilities) → CSV in data/
   ├─ EmbeddingService → scrape + sentence-transformers + HDBSCAN + FAISS → *.index / *.json
   ├─ ChatService → FAISS search + Gemini (google.generativeai)
   └─ AnalysisService → keyword frequency / co-occurrence / networkx centrality
```

The **`data/` folder** is the integration point — everything is keyed off a CSV filename.
Location: `backend/app/core/config.py` → `DATA_FOLDER = <repo>/data` (3 levels up from `app/core`).
All artifacts for a CSV are named off its base filename (see §6).

## 2. Backend layout

```
backend/
  main.py                     FastAPI app, CORS(*), mounts 5 routers, /health
  app/core/
    config.py                 Settings (pydantic-settings, reads backend/.env). lru_cached.
    dependencies.py           get_sentence_model() + get_llm_instance() — both lru_cached
    logging.py                setup_logging()
  app/models/schemas.py       ALL pydantic request/response models
  app/api/routes/             search.py chat.py files.py embeddings.py analysis.py
  app/services/               search/pubmed/embedding/chat/analysis services
  features/
    embedding_and_indexing.py FAISS helpers: build_faiss_index, search_faiss, save_*
    search_pubmed.py          (legacy/standalone PubMed script; runtime uses services/pubmed_service.py)
  utils/result_processor.py   get_context_from_result() → numbered LLM context + source lists
```

Key config (`Settings`): `EMBEDDING_MODEL='all-mpnet-base-v2'`, `GEMINI_MODEL='gemini-2.5-flash'`,
`SCRAPE_FULL_TEXT=True`, `SCRAPE_CONCURRENCY=10`, `SCRAPE_TIMEOUT=10`, `SCRAPE_MAX_PAPERS=0` (no cap).
Secrets from `backend/.env`: `GOOGLE_GENAI_API_KEY`, `EMAIL`, `PUBMED_API_KEY`.

Models load lazily and are cached: sentence-transformer + Gemini built on first dependency use, not at startup.

## 3. Frontend layout

```
frontend/src/
  main.tsx, App.tsx           Router. Providers nest: Theme>Search>Embedding>Chat>Analytics>Layout
  services/api.ts             axios instance + ALL typed API wrappers (searchApi, filesApi,
                              chatApi, embeddingsApi, healthApi). Base = VITE_API_BASE_URL
                              or http://localhost:8000/api/v1. timeout 120s.
  types/index.ts              Paper, ChatMessage, SearchFilters, Theme
  context/                    SearchContext, EmbeddingContext, ChatContext, AnalyticsContext
  pages/                      HomePage, SearchPage, ChatPage, AnalyticsPage, SettingsPage
  components/layout/          Layout (Navbar + fixed Sidebar + Footer), Navbar, Sidebar, Footer
  components/EmbeddingProgressModal.tsx   shared, reads EmbeddingContext
  components/ui/              shadcn primitives
```

**Why contexts sit above the router:** in-flight work (search polling, embedding job, analytics
results) must survive navigation. All four providers wrap `<Layout>` so state + polling persist
across page changes. Routes: `/` `/search` `/chat` `/analytics` `/settings`.

## 4. The five backend route groups

### `/api/v1/search` (search.py) — async, poll-based
The whole search is **fire-and-forget + polling**, not a blocking request.
- `POST /search/` — starts a background `asyncio.Task`, returns an empty `SearchResponse` immediately.
  Module-global state holds progress + last results (`search_progress_state`, `_last_results`,
  `_last_csv_filename`, `_current_search_task`, `_cancel_event`). Starting a new search cancels the old.
- `GET /search/progress` — returns `SearchProgress` {stage 0–4 / -1, status idle|searching|completed|error|cancelled, progress 0–100, message}.
- `GET /search/results?page&per_page` — paginated slice of the last completed search.
- `POST /search/cancel` — sets the cooperative `threading.Event` + cancels the task.
- `GET /search/` — same as POST but params in querystring (compat).

Progress stages: 0 init → 1 querying API → 2 found/extract metadata → 3 saving CSV → 4 done.
On completion it writes `<sanitized_query>.csv` (`re.sub(r"[^a-zA-Z0-9]","_",query)`) to `data/`.

### `/api/v1/embeddings` (embeddings.py) — async background task
- `POST /embeddings/{filename}` body `EmbeddingOptions{scrape_full_text?, max_scrape?, force?}`.
  Skips rebuild if all 3 artifacts exist **unless `force`**. Uses `BackgroundTasks`.
- `GET /embeddings/progress` — `EmbeddingProgress` {stage 0–3 / -1, percent, message}.
- `POST /embeddings/cancel` — cooperative `threading.Event`.
- `DELETE /embeddings/{filename}` — removes the 3 artifacts.
- `GET /embeddings/{filename}/status` — `embeddings_exist` bool + file list.

### `/api/v1/chat` (chat.py) — synchronous RAG
- `POST /chat/{filename}` or `POST /chat/` (filename in body), body `ChatRequest{message, filename?}`.
- Returns `ChatResponse{response, sources[], query}`.
- If no FAISS index for the file → falls back to a **general Gemini answer** (no sources).

### `/api/v1/files` (files.py)
`POST /files/upload` (CSV only), `GET /files/download/{filename}`,
`GET /files/csv/{filename}/data` (→ `Paper[]` JSON), `.../paginated`,
`GET /files/list` (→ `FileInfo[]`), `DELETE /files/{filename}`.

### `/api/v1/analysis` (analysis.py) — EXISTS BUT FRONTEND DOESN'T USE IT
Full backend keyword analytics (`AnalysisService`): `/analysis/files`, `POST /analysis/generate`,
`GET /{filename}/summary`, `GET /{filename}/matrix`, `POST /{filename}/regenerate`.
⚠️ **The current AnalyticsPage computes everything client-side instead** (see §5d). These routes
are effectively dead code from the UI's perspective, though fully implemented and tested-shaped.

## 5. Page-by-page data flow

### a) SearchPage (`/search`) + SearchContext
1. User types query, picks filters (source=pubmed only, maxResults default 100, year range slider).
2. `handleSearch()` → `searchApi.search()` POST. Frontend sends **`use_raw_query: false`**, so the
   backend expands each comma-separated concept with abbreviation + manual synonyms + live MeSH
   descriptors **and MeSH entry-term synonyms** (works for any topic in MeSH). Separate concepts with commas to AND them.
3. SearchContext polls `GET /search/progress` every 1s while `isLoading`.
4. On `status==='completed'` → `searchApi.getResults(1, maxResults)` → stores `allResults`, `csvFilename`.
5. Pagination is **client-side** (`displayedResults` = slice of `allResults` by page/perPage).
6. Result actions: Export CSV (`filesApi.download`), Create Embeddings (`startEmbeddings`),
   Open in Analytics (`navigate('/analytics', {state:{filename, query}})`).
- Polling resumes on mount if a search is already running on the backend.

### b) ChatPage (`/chat`) + ChatContext + EmbeddingContext
1. Loads CSV list (`filesApi.list`), user selects/uploads a file.
2. Shows embedding badge via `embeddingsApi.getStatus`. Can Create/Recreate embeddings + toggle "scrape full text".
3. `sendMessage()` → `chatApi.sendMessageBody({message, filename})` → renders answer + collapsible source cards.
4. When an embedding job (started anywhere) finishes, ChatContext auto-adds that file to the dropdown and selects it.
- Input disabled while embeddings build or no file selected. Backend handles the "no index" case gracefully.

### c) EmbeddingContext + EmbeddingProgressModal (app-wide, single job)
- Backend tracks **one** embedding job; this provider owns it. `startEmbeddings(filename, force)` →
  `embeddingsApi.create`. Polls `GET /embeddings/progress` every 1s until stage 3 (done) or -1 (error/cancel).
- Modal is dropped on both Search and Chat pages; both show the same shared job. `completedFile` lets
  Chat react. Resumes polling on mount.

### d) AnalyticsPage (`/analytics`) + AnalyticsContext — ALL CLIENT-SIDE
- **Does NOT call the `/analysis` backend routes.** It calls `filesApi.getCsvData(filename)` to get `Paper[]`,
  then computes everything in the browser:
  - `buildSummary()` — keyword frequency, co-occurrence pairs, simple degree-based "centrality".
  - `buildMatrix()` — keyword presence matrix (capped at 50 keyword columns, `previewRows` rows).
  - `extractKeywords()` — splits `paper.keywords` on `,;|`, lowercased.
- Renders: word cloud, force-ish network graph (SVG, zoom/pan), centrality table, keyword matrix,
  frequency chart, summary. Has PNG export (`svgToPng`) and CSV/JSON download (built in-browser, no backend).
- `paperCache` (Map in context) avoids refetching. `generateOnSelect` auto-runs on file select.
- Accepts `location.state.filename` from the Search page's "Open in Analytics".

### e) HomePage / SettingsPage
- HomePage: marketing landing + live API health badge (`healthApi.check` → `/health`). Some buttons are stubs.
- SettingsPage: theme toggle works (theme-provider); **other settings are local state only, not persisted/applied** (`handleSave` just console.logs).

## 6. data/ folder artifact naming (keyed off CSV base name `<base>`)

| Producer | File |
|---|---|
| Search | `<base>.csv` (the papers) |
| Embedding | `<base>_full_text_mapping.json` (scraped/abstract text per paper) |
| Embedding | `<base>_paper_chunks_hdbscan.index` (FAISS) |
| Embedding | `<base>_paper_chunk_metadata_hdbscan.json` (flat chunk list) |
| Embedding | `<base>_paper_data_doi_mapped_hdbscan.json` (chunks grouped by DOI) |
| Analysis (backend, unused by UI) | `<base>_analysis_normalized_metadata.json`, `_analysis_keyword_frequency.csv`, `_analysis_keyword_presence_matrix.csv`, `_analysis_summary.json` |

The 3 `*_hdbscan.*` files are the trio checked for "embeddings exist".

## 7. Pipelines in detail

### Search pipeline (PubMedService, `services/pubmed_service.py`)
- Runs in a dedicated `ThreadPoolExecutor` (blocking `requests` + `time.sleep` rate limiting).
- Rate limit: 0.1s with API key (10 req/s), else 0.34s. `POST` to NCBI E-utilities with retry/backoff.
- **Two query modes:**
  - `use_raw_query=True`: query passed straight to `esearch` — matches PubMed website.
  - `use_raw_query=False` (what the UI now sends): per-concept expansion via `_build_expanded_query_for_term()`.
    Comma-separated concepts are AND'd. Each concept (+ its `SYNONYM_MAP` entries) becomes a clause via
    `_concept_clause()`: **single word → left untagged** so PubMed's Automatic Term Mapping (ATM) expands it
    to the right MeSH descriptor + synonyms; **multi-word → `("phrase"[MeSH Terms] OR "phrase")`** to keep the
    exact phrase (no `screen AND time` splitting) while still matching the MeSH descriptor.
    NOTE: the old live MeSH-database lookup (`_fetch_mesh_terms`) was removed — it parsed NCBI's plain-text
    MeSH efetch as XML (always silently failed) and its esearch ranking returned junk (diabetes→"Donohue Syndrome").
- Zero-result fallback: `_spell_check()` via NCBI **ESpell**, retry once with corrected spelling;
  surfaces as `last_corrected_query` → "Showing results for …" message.
- Flow: `esearch` (PMIDs, paged, fetch_limit=min(max*2,1000)) → `efetch` (XML, batch 50) + `esummary` (year/journal)
  → `_extract_paper_info()` per article → DataFrame → post-fetch date filter → `.head(max_results)`.
- Output dict keys include `Title, Abstract, Publication Year, Source, DOI, Download_URL, Keywords, MeSH_Terms, Authors, PMID, Reference` (plus `Relevance_Score`/`Relevance_Rank` after re-ranking). Note: the legacy duplicate `Year_Published` column was removed — readers prefer `Publication Year` and fall back to `Year_Published` for older CSVs.
- `SearchService.save_results_to_csv()` writes CSV (`utf-8-sig`) and returns `Paper[]`.
  Authors/Keywords are real lists from XML (not parsed back out of strings).

### Embedding pipeline (EmbeddingService, `services/embedding_service.py`)
1. **Stage 1 — full-text extraction** (`extract_full_text_to_json`): every paper seeded with its abstract;
   if `scrape_full_text` and a URL exists, fetch concurrently (asyncio + `requests` in executor),
   bounded by `SCRAPE_CONCURRENCY` global semaphore + **per-domain locks**. BeautifulSoup pulls main
   content selectors. Writes `<base>_full_text_mapping.json` (unique_id = DOI or `paper_N` → text).
   Fast path: nothing to scrape → just abstracts.
2. **Stage 2 — embeddings** (`process_data_with_json_mapping`): for each paper, `sent_tokenize` →
   sentence-transformer encode (normalized) → **HDBSCAN semantic chunking** (`semantic_chunking_hdbscan`,
   falls back to one chunk) → `split_oversized_chunks` (max 800 tokens) → chunk vector = mean of sentence vectors.
   Metadata per chunk: text, paperTitle, doi, source, yearPublished, chunk_index_in_doc.
3. Build FAISS `IndexFlatL2` over L2-normalized vectors (cosine via L2) → save index + both JSONs.
- Cooperative cancellation checked between papers/stages. Progress: percent 5→50 (scrape), 50→96 (embed), 96→100 (save).

### Chat / RAG pipeline (ChatService, `services/chat_service.py`)
1. If no FAISS index → `_generate_general_response()` (plain Gemini, no context).
2. Else: `_decompose_query()` — Gemini splits the question into ≤5 sub-queries.
3. For each sub-query, `search_faiss(k=5)` (`features/embedding_and_indexing.py`) → chunk dicts w/ distance.
4. Deduplicate by `chunk_id` (keep smallest distance), sort by distance.
5. `get_context_from_result()` (`utils/result_processor.py`) → numbered context `[1] [Source Title: …]`
   + aligned `paper_titles`/`download_urls` (URL from CSV DOI→URL map, fallback `https://doi.org/<doi>`).
6. `_generate_ai_response_original()` — big citation-enforcing prompt → Gemini → answer with `[n]` markers.
7. Sources returned as cards (`_create_sources_from_papers`).
- Gemini system instruction set in `dependencies.get_llm_instance()`. If no API key → llm is None → chat 500s.

### Analysis (backend AnalysisService — implemented, UI bypasses it)
Normalizes metadata, keyword frequency (with alias map iot→internet of things etc.), presence matrix,
co-occurrence, and **networkx** centrality (degree/closeness/betweenness/eigenvector/clustering).
Writes 4 `_analysis_*` files. Reachable only by hitting `/api/v1/analysis/*` directly.

## 8. Gotchas / things to remember
- **CORE search is a stub** — `SearchService._search_core` returns `[]`. Only PubMed works. UI source dropdown only lists PubMed.
- **Frontend sends `use_raw_query: false`** → backend synonym/MeSH expansion runs. Concepts must be comma-separated to AND-split. (Was `true` originally; flipped so MeSH/synonym expansion is active.)
- **Analytics is fully client-side**; backend `/analysis` routes + `AnalysisService` are unused by the app.
- **SettingsPage doesn't persist** anything except theme.
- Search results + progress live in **module-global backend state** → single-user / single-search assumption (same for embeddings: one job at a time).
- Pagination on SearchPage is client-side over the full `allResults`.
- `data/` path is derived relative to `config.py`; the FAISS helpers in `features/` derive their own `_DATA_FOLDER` 2 levels up from the file — keep these consistent if moving files.
- `backend/.venv/` and `frontend/node_modules/` are vendored in-tree; ignore when searching.
- Existing docs: `README.md`, `FEATURES_2026-05-29.md`, `Research_Rover_Analysis_Phases_Documentation.md`, `Research_Rover_New_Changes_Documentation.md`.

## 9. Run it
- Backend: `cd backend` → (activate `.venv`) → `python main.py` (uvicorn on `0.0.0.0:8000`, reload). Needs `backend/.env` keys.
- Frontend: `cd frontend` → `npm install` → `npm run dev` (Vite). Talks to `http://localhost:8000/api/v1`.
