# Research Rover - New Changes Documentation

**Repository:** Research Rover  
**Scope:** Current tracked code plus the latest uncommitted changes in the working tree  
**Date:** 2026-04-25

## 1. Overview

This document summarizes the major new work that has been added to the repo. The current version of Research Rover has evolved into a FastAPI + React research-paper platform with:

- PubMed-based paper search
- improved query handling
- date-range filtering with real `date` inputs
- richer PubMed metadata extraction
- a cleaner CSV-to-JSON full-text pipeline
- embedding generation from abstract/full text
- an upgraded search UI with keyword parsing, date pickers, pagination, and PDF download support

The important idea in the latest changes is that the app now preserves more bibliographic data from PubMed and handles search inputs in a more flexible way.

## 2. What Was Newly Added or Improved

### Backend search flow

The search API now accepts:

- `keywords` as a list
- `query` as a fallback
- `start_date` and `end_date` instead of year-only filters
- a `search_source` enum

The request model also validates that at least one of `keywords` or `query` is present.

### PubMed search handling

PubMed search was upgraded in several ways:

- exact date filtering now uses real dates instead of year buckets
- pre-built boolean queries are preserved instead of being rewritten
- summary metadata is fetched from PubMed `esummary`
- more paper fields are extracted, including:
  - `PMID`
  - `PMCID`
  - `NIHMS ID`
  - `Citation`
  - `Create Date`
  - `First Author`
  - `Reference`
- publication year is resolved more accurately from PubMed data

### CSV and paper normalization

The search service now exports a broader set of columns and keeps both Rover-style and PubMed-style naming aligned:

- `DOI` and `Doi`
- `Source` and `Journal/Book`
- `Year_Published` and `Publication Year`

This reduces breakage when different parts of the pipeline read the same dataset.

### Embedding pipeline

The embedding service now:

- accepts both `Doi` and `DOI`
- keeps full text in a separate JSON mapping file
- avoids polluting the CSV with a `Full_Text` column
- falls back to abstracts if full text cannot be extracted

### Frontend search page

The search page now supports:

- comma-separated keyword input
- date picker filters
- client-side pagination after fetching search results
- progress polling during search
- PDF download attempts for each returned paper
- an improved hint message explaining how to enter multiple keywords

## 3. Backend Changes

### 3.1 Request schema updates

File: `backend/app/models/schemas.py`

The `SearchRequest` schema changed from a single query string and year range to a more flexible model.

```python
class SearchRequest(BaseModel):
    keywords: Optional[List[str]] = Field(None, description="List of search keywords")
    query: Optional[str] = Field(None, min_length=1, max_length=500)
    page: int = Field(1, ge=1)
    per_page: int = Field(10, ge=1)
    max_results: int = Field(10, ge=1)
    start_date: Optional[date] = Field(None, description="Start date filter")
    end_date: Optional[date] = Field(None, description="End date filter")
    search_source: SearchSource = Field(SearchSource.CORE)
```

The validation logic now ensures:

- `end_date` cannot be earlier than `start_date`
- either `keywords` or `query` must be provided

The query builder now turns keywords into a PubMed-friendly boolean string:

```python
def build_query_string(self) -> str:
    if self.keywords and len(self.keywords) > 0:
        formatted = []
        for k in self.keywords:
            k = k.strip()
            if " " in k:
                formatted.append(f'"{k}"')
            else:
                formatted.append(k)
        return " OR ".join(formatted)

    return self.query.strip()
```

### 3.2 Search route updates

File: `backend/app/api/routes/search.py`

The route now uses `request.build_query_string()` so the backend always receives the final search expression in a consistent format.

```python
query = request.build_query_string()
results = await search_service.search_papers(
    query=query,
    max_results=request.max_results,
    start_date=request.start_date,
    end_date=request.end_date,
    search_source=request.search_source
)
```

The GET endpoint also switched from `start_year` / `end_year` to `start_date` / `end_date`.

### 3.3 Search service improvements

File: `backend/app/services/search_service.py`

The search service now preserves existing boolean query structure when the query already contains `AND`, `OR`, `NOT`, or parentheses.

```python
def _is_composed_pubmed_query(self, query: str) -> bool:
    if not query:
        return False
    upper_query = f" {query.upper()} "
    return any(token in upper_query for token in (" AND ", " OR ", " NOT ", "(", ")"))
```

For PubMed searches, the service now:

- strips empty queries early
- keeps already-built boolean queries untouched
- passes date filters as `date` objects
- uses `PubMedService` for optimized retrieval

The CSV export logic was also expanded to preserve more bibliographic columns:

- `PMID`
- `Title`
- `Authors`
- `Abstract`
- `Source`
- `Journal/Book`
- `Year_Published`
- `Publication Year`
- `Create Date`
- `Citation`
- `First Author`
- `PMCID`
- `NIHMS ID`
- `DOI`
- `Download_URL`
- `Keywords`
- `Reference`

This part matters because the downstream embedding and chat flows rely on clean, stable metadata.

### 3.4 PubMed service upgrades

File: `backend/app/services/pubmed_service.py`

This is one of the biggest backend improvements.

#### Exact date filters

The old year-based filter was replaced with exact date logic:

```python
def _build_date_filter(self, start_date: Optional[date], end_date: Optional[date]) -> str:
    if start_date and end_date:
        return f"{start_date.strftime('%Y/%m/%d')}:{end_date.strftime('%Y/%m/%d')}[pdat]"
    elif start_date:
        return f"{start_date.strftime('%Y/%m/%d')}:3000/12/31[pdat]"
    elif end_date:
        return f"1900/01/01:{end_date.strftime('%Y/%m/%d')}[pdat]"
    return ""
```

#### Summary metadata fetch

The service now calls PubMed `esummary` to enrich paper records with journal and publication-year metadata.

#### Richer extracted fields

The XML parser now builds a broader paper record:

```python
paper = {
    'Title': title,
    'Abstract': abstract,
    'Year_Published': publication_year,
    'Publication Year': publication_year,
    'Source': journal,
    'Journal/Book': journal,
    'DOI': doi,
    'Download_URL': download_url,
    'Keywords': keywords,
    'Authors': authors,
    'PMID': pmid,
    'Citation': citation,
    'Create Date': create_date,
    'PMCID': pmcid,
    'NIHMS ID': nihms_id,
    'First Author': first_author,
    'Reference': reference
}
```

This means the app can now store and display more publication context than before.

### 3.5 Embedding service updates

File: `backend/app/services/embedding_service.py`

The embedding service now accepts both DOI column spellings:

```python
doi = str(row.get('Doi') or row.get('DOI') or '')
```

It also keeps CSVs clean by continuing the JSON-based full-text mapping approach instead of adding a `Full_Text` column to the CSV.

This is useful because:

- metadata CSV stays lightweight
- full text is stored separately
- embeddings can still use abstract fallback if scraping fails

## 4. Frontend Changes

### 4.1 Search input now supports multiple keywords

File: `frontend/src/pages/SearchPage.tsx`

The search bar now accepts comma-separated keywords, which are split into an array before being sent to the backend.

```tsx
const parseKeywords = (input: string): string[] => {
  return input
    .split(',')
    .map(k => k.trim().replace(/^["']|["']$/g, ''))
    .filter(k => k.length > 0)
}
```

### 4.2 Date picker filters

The old year inputs were replaced with HTML date inputs and picker buttons.

```tsx
<Input
  type="date"
  value={filters.startDate || ''}
  onChange={(e) => setFilters({ ...filters, startDate: e.target.value || undefined })}
  ref={setStartDateInput}
/>
```

The page also adds a helper to open the picker on click or hover:

```tsx
const openDatePicker = (input: HTMLInputElement | null) => {
  if (!input) return
  if (typeof input.showPicker === 'function') {
    input.showPicker()
  } else {
    input.focus()
    input.click()
  }
}
```

### 4.3 Search request format

The frontend now sends `keywords`, `start_date`, and `end_date` instead of only a plain query string and year range.

```tsx
const searchRequest: SearchRequest = {
  keywords: keywords,
  page: 1,
  per_page: filters.maxResults || 100,
  max_results: filters.maxResults || 100,
  search_source: filters.source,
  ...(filters.startDate && { start_date: filters.startDate }),
  ...(filters.endDate && { end_date: filters.endDate }),
}
```

### 4.4 Progress and pagination

The page keeps:

- full result set in memory
- a separate display slice for the active page
- polling-based search progress updates

This gives the UI smoother pagination without forcing another server request for every page click.

### 4.5 PDF download helper

The page now also attempts to download every paper PDF when a direct `download_url` exists. It creates safe filenames from titles and falls back to opening the link in a new tab if the response is not a direct PDF.

## 5. API and Type Updates

### Frontend API layer

File: `frontend/src/services/api.ts`

The request type now matches the new backend contract:

```ts
export interface SearchRequest {
  keywords: string[]
  query?: string
  page?: number
  per_page?: number
  max_results?: number
  start_date?: string
  end_date?: string
  search_source?: 'core' | 'pubmed'
}
```

The `SearchProgress` interface still supports stage-based progress polling and now fits the updated backend status model.

### Shared types

File: `frontend/src/types/index.ts`

The `SearchFilters` type now stores date strings:

```ts
export interface SearchFilters {
  startDate?: string
  endDate?: string
  source: 'core' | 'pubmed'
  maxResults?: number
}
```

## 6. Libraries Used

### Backend runtime libraries

Key backend libraries used by the current implementation include:

- `fastapi` for the API
- `uvicorn` as the ASGI server
- `pydantic` and `pydantic-settings` for schema and configuration handling
- `httpx` and `requests` for HTTP calls
- `pandas` for tabular data handling
- `beautifulsoup4` for HTML parsing
- `crawl4ai` for web extraction support
- `faiss-cpu` for vector similarity search
- `sentence-transformers` for embeddings
- `hdbscan` for semantic chunk grouping
- `nltk` for sentence tokenization
- `numpy` and `scipy` for numeric processing
- `torch` and `transformers` for model support
- `google-generativeai` and `openai` for LLM-related functionality
- `python-dotenv` for environment configuration
- `loguru` and standard `logging` for logging

The full pinned list lives in `backend/requirements.txt`.

### Frontend runtime libraries

Key frontend libraries used by the current UI include:

- `react` and `react-dom`
- `react-router-dom`
- `typescript`
- `vite`
- `axios`
- `framer-motion`
- `lucide-react`
- `@heroicons/react`
- `@radix-ui/*` components
- `tailwindcss`
- `tailwind-merge`
- `clsx`
- `class-variance-authority`
- `sonner`

The full dependency list lives in `frontend/package.json`.

## 7. Updated Data Flow

The new flow is:

1. User enters comma-separated keywords and optional date range
2. Frontend converts input to `keywords[]`
3. Backend builds a clean query string
4. PubMed search runs with exact date filtering
5. PubMed records are normalized into a richer paper schema
6. CSV is saved with metadata-only fields
7. Full text is stored separately in JSON
8. Embeddings are generated from abstract/full text
9. Search results are shown in the UI with pagination and download options

## 8. Notes on Current State

- The repo is currently on a FastAPI + React stack, not the older Flask-based version shown in the earlier README history.
- The search pipeline is now more PubMed-centric.
- The CSV format is more stable because it preserves both Rover-native and PubMed-native column names.
- Some generated files are present in `data/`, which indicates the current pipeline has already been exercised.

## 9. Files Most Directly Changed

- `backend/app/models/schemas.py`
- `backend/app/api/routes/search.py`
- `backend/app/services/search_service.py`
- `backend/app/services/pubmed_service.py`
- `backend/app/services/embedding_service.py`
- `frontend/src/pages/SearchPage.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/index.ts`
- `backend/requirements.txt`
- `frontend/package.json`

## 10. Short Summary

The latest work focuses on making Research Rover more accurate, more metadata-rich, and easier to use:

- better query input
- exact date filtering
- richer PubMed extraction
- cleaner CSV and JSON separation
- safer DOI handling
- improved frontend controls
- smoother search progress and result navigation

If you want this turned into a formal report style document next, this markdown can be converted into a Word or PDF layout later.
