import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import type { Paper, SearchFilters } from '@/types'
import { searchApi, type SearchRequest, type SearchProgress } from '@/services/api'

// ─── Shape of the shared search state ───────────────────────────────────────
interface SearchContextValue {
  query: string
  setQuery: (q: string) => void
  filters: SearchFilters
  setFilters: (f: SearchFilters) => void

  isLoading: boolean
  allResults: Paper[]
  displayedResults: Paper[]
  csvFilename: string
  searchProgress: SearchProgress | null
  error: string
  setError: (e: string) => void

  currentPage: number
  setCurrentPage: (p: number) => void
  totalResults: number
  totalPages: number
  perPage: number
  setPerPage: (n: number) => void

  handleSearch: () => Promise<void>
  handleCancel: () => Promise<void>
  handlePageChange: (page: number) => void
}

const SearchContext = createContext<SearchContextValue | undefined>(undefined)

/**
 * Holds all search state above the router so an in-flight search — and its
 * results — survive navigating to Chat, Analytics, etc. Polling keeps running
 * in the background regardless of which page is mounted.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [allResults, setAllResults] = useState<Paper[]>([])
  const [displayedResults, setDisplayedResults] = useState<Paper[]>([])
  const [csvFilename, setCsvFilename] = useState('')
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({
    source: 'pubmed',
    maxResults: 100,
    startDate: `${new Date().getFullYear()}-01-01`,
    sortMode: 'relevance',
  })

  const [currentPage, setCurrentPage] = useState(1)
  const [totalResults, setTotalResults] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [perPage, setPerPage] = useState(10)

  // Keep filters/perPage readable inside the polling interval without
  // re-subscribing the effect on every keystroke.
  const filtersRef = useRef(filters)
  const perPageRef = useRef(perPage)
  useEffect(() => { filtersRef.current = filters }, [filters])
  useEffect(() => { perPageRef.current = perPage }, [perPage])

  // On first mount, resume polling if a search is already running on the backend.
  useEffect(() => {
    let cancelled = false
    searchApi
      .getProgress()
      .then((progress) => {
        if (cancelled) return
        if (progress.status === 'searching') {
          setSearchProgress(progress)
          setIsLoading(true)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Sync the displayed slice whenever results / page / page-size change.
  useEffect(() => {
    if (allResults.length > 0) {
      const start = (currentPage - 1) * perPage
      setDisplayedResults(allResults.slice(start, start + perPage))
      const tp = Math.ceil(allResults.length / perPage)
      setTotalPages(tp)
      if (currentPage > tp && tp > 0) setCurrentPage(tp)
    }
  }, [allResults, currentPage, perPage])

  // Background progress polling — runs as long as a search is loading,
  // independent of which page the user is viewing.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    if (isLoading) {
      interval = setInterval(async () => {
        try {
          const progress = await searchApi.getProgress()
          setSearchProgress(progress)
          if (progress.status === 'completed') {
            if (interval) clearInterval(interval)
            try {
              const data = await searchApi.getResults(1, filtersRef.current.maxResults || 100)
              setAllResults(data.results)
              setCsvFilename(data.csv_filename)
              setTotalResults(data.total_results)
              setTotalPages(Math.ceil(data.total_results / perPageRef.current))
              setDisplayedResults(data.results.slice(0, perPageRef.current))
              setCurrentPage(1)
            } catch {
              setError('Search completed but failed to load results.')
            }
            setIsLoading(false)
          } else if (progress.status === 'error') {
            setError(progress.message || 'Search failed')
            setIsLoading(false)
            if (interval) clearInterval(interval)
          } else if (progress.status === 'cancelled') {
            // Cancelled elsewhere (or by us) — stop polling, leave no error.
            setIsLoading(false)
            if (interval) clearInterval(interval)
          }
        } catch {}
      }, 1000)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [isLoading])

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsLoading(true)
    setError('')
    setAllResults([])
    setDisplayedResults([])
    setCurrentPage(1)
    setSearchProgress(null)
    try {
      const req: SearchRequest = {
        query: query.trim(),
        page: 1,
        per_page: filters.maxResults || 100,
        max_results: filters.maxResults || 100,
        search_source: filters.source,
        // false → backend expands the query with abbreviation, synonym, and
        // MeSH-ontology terms (see PubMedService._build_expanded_query_for_term).
        // Separate distinct concepts with commas to AND them as separate blocks.
        use_raw_query: false,
        // relevance → MedCPT semantic re-rank; recency → newest-first.
        sort_mode: filters.sortMode || 'relevance',
        ...(filters.startDate && { start_date: filters.startDate }),
        ...(filters.endDate && { end_date: filters.endDate }),
      }
      await searchApi.search(req)
    } catch (err: any) {
      setError(err.error || 'An error occurred during search')
      setIsLoading(false)
    }
  }

  const handleCancel = async () => {
    // Stop the UI immediately; the polling effect's cleanup clears the interval
    // when isLoading flips to false.
    setIsLoading(false)
    setSearchProgress(null)
    try {
      await searchApi.cancel()
    } catch {
      // Best-effort — the search is already stopped client-side regardless.
    }
  }

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) setCurrentPage(page)
  }

  const value: SearchContextValue = {
    query, setQuery,
    filters, setFilters,
    isLoading,
    allResults,
    displayedResults,
    csvFilename,
    searchProgress,
    error, setError,
    currentPage, setCurrentPage,
    totalResults,
    totalPages,
    perPage, setPerPage,
    handleSearch,
    handleCancel,
    handlePageChange,
  }

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearch() {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch must be used within a SearchProvider')
  return ctx
}
