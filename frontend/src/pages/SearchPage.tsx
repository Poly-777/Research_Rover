import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import {
  MagnifyingGlassIcon,
  DocumentArrowDownIcon,
  EyeIcon,
  CalendarIcon,
  TagIcon,
  LinkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CpuChipIcon,
  UserGroupIcon,
  XCircleIcon,
  CheckCircleIcon,
  FunnelIcon,
  ChartBarIcon,
  SparklesIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import type { Paper } from '@/types'
import { filesApi, type SearchProgress } from '@/services/api'
import { useSearch } from '@/context/SearchContext'
import { useEmbedding } from '@/context/EmbeddingContext'
import { EmbeddingProgressModal } from '@/components/EmbeddingProgressModal'

// ─── Dual-handle publication-year range slider ──────────────────────────────
const SLIDER_MIN_YEAR = 1950
const SLIDER_MAX_YEAR = new Date().getFullYear()

function YearRangeSlider({
  startDate,
  endDate,
  onChange,
}: {
  startDate?: string
  endDate?: string
  onChange: (range: { startDate?: string; endDate?: string }) => void
}) {
  // Filter dates are stored as YYYY-MM-DD; an undefined bound = open-ended,
  // which the slider shows as sitting at the far min / max.
  const startYear = startDate ? Number(startDate.slice(0, 4)) : SLIDER_MIN_YEAR
  const endYear = endDate ? Number(endDate.slice(0, 4)) : SLIDER_MAX_YEAR
  const span = SLIDER_MAX_YEAR - SLIDER_MIN_YEAR
  const lowPct = ((startYear - SLIDER_MIN_YEAR) / span) * 100
  const highPct = ((endYear - SLIDER_MIN_YEAR) / span) * 100
  const isFullRange = startYear <= SLIDER_MIN_YEAR && endYear >= SLIDER_MAX_YEAR

  // Hitting an extreme clears that bound so the search stays open-ended on that side.
  const emit = (lo: number, hi: number) =>
    onChange({
      startDate: lo <= SLIDER_MIN_YEAR ? undefined : `${lo}-01-01`,
      endDate: hi >= SLIDER_MAX_YEAR ? undefined : `${hi}-12-31`,
    })

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Publication years
        </label>
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-400">
            {isFullRange ? 'Any year' : `${startYear} — ${endYear}`}
          </span>
          {!isFullRange && (
            <button
              type="button"
              onClick={() => onChange({ startDate: undefined, endDate: undefined })}
              className="text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Reset
            </button>
          )}
        </span>
      </div>

      {/* Waveform: synthetic publication-density curve so users can see at a
          glance how the range maps onto recent vs. older years. Bars inside
          the selected span are tinted; outside ones are muted. */}
      <div className="flex h-12 items-end gap-[1px] px-0.5">
        {Array.from({ length: span + 1 }, (_, i) => {
          const year = SLIDER_MIN_YEAR + i
          const t = i / span
          const base = Math.pow(t, 1.5) * 0.85 + 0.12
          const wave = Math.sin(t * Math.PI * 9) * 0.07
          const h = Math.max(0.1, Math.min(1, base + wave))
          const inRange = year >= startYear && year <= endYear
          return (
            <div
              key={year}
              className={`flex-1 rounded-t-sm transition-colors duration-200 ${
                inRange
                  ? 'bg-gradient-to-t from-blue-500 to-indigo-400'
                  : 'bg-gray-200 dark:bg-gray-700/60'
              }`}
              style={{ height: `${h * 100}%` }}
            />
          )
        })}
      </div>

      <div className="relative flex h-9 items-center">
        {/* Base track */}
        <div className="absolute h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700" />
        {/* Selected span */}
        <div
          className="absolute h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
          style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }}
        />
        {/* Lower handle — raised above the upper one when it sits in the right half
            so it stays grabbable even when the two thumbs are close together. */}
        <input
          type="range"
          min={SLIDER_MIN_YEAR}
          max={SLIDER_MAX_YEAR}
          value={startYear}
          aria-label="Earliest publication year"
          onChange={(e) => emit(Math.min(Number(e.target.value), endYear), endYear)}
          className="year-range"
          style={{ zIndex: lowPct > 50 ? 5 : 3 }}
        />
        {/* Upper handle */}
        <input
          type="range"
          min={SLIDER_MIN_YEAR}
          max={SLIDER_MAX_YEAR}
          value={endYear}
          aria-label="Latest publication year"
          onChange={(e) => emit(startYear, Math.max(Number(e.target.value), startYear))}
          className="year-range"
          style={{ zIndex: 4 }}
        />
      </div>

      <div className="flex justify-between text-[10px] font-medium text-gray-400 dark:text-gray-500">
        <span>{SLIDER_MIN_YEAR}</span>
        <span>{SLIDER_MAX_YEAR}</span>
      </div>
    </div>
  )
}

// ─── Spinner SVG ─────────────────────────────────────────────────────────────
function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ─── Progress stepper ─────────────────────────────────────────────────────────
const STEPS = [
  { stage: 0, label: 'Init' },
  { stage: 1, label: 'Query' },
  { stage: 2, label: 'Process' },
  { stage: 3, label: 'Save' },
  { stage: 4, label: 'Done' },
]

function SearchProgressPanel({ progress, onCancel }: { progress: SearchProgress; onCancel?: () => void }) {
  const pct = Math.min(100, Math.max(0, progress.progress || 0))
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto"
    >
      <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
        <CardContent className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              <Spinner className="w-4 h-4 text-blue-500" />
              Searching PubMed…
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{pct}%</span>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="inline-flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold
                             text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800
                             hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <XCircleIcon className="w-3.5 h-3.5" />
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Bar */}
          <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>

          {/* Steps */}
          <div className="flex justify-between">
            {STEPS.map((step) => {
              const done = (progress.stage || 0) > step.stage
              const active = (progress.stage || 0) === step.stage
              return (
                <div key={step.stage} className="flex flex-col items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-500 text-white ring-4 ring-blue-100 dark:ring-blue-900' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'}`}>
                    {done ? '✓' : step.stage}
                  </div>
                  <span className={`text-xs ${active ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Status message */}
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            {progress.message}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Paper card ───────────────────────────────────────────────────────────────
function PaperCard({ paper, index }: { paper: Paper; index: number }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
    >
      <Card className="border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white dark:bg-gray-900">
        <CardContent className="p-5">
          <div className="flex gap-4">
            {/* Left: number */}
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{index + 1}</span>
            </div>

            {/* Right: content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Title row */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                  {paper.title}
                </h3>
                <div className="flex-shrink-0 flex items-center gap-1.5">
                  {paper.relevance_score != null && (
                    <span
                      title="Semantic relevance to your query (MedCPT), relative within this result set"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold
                                 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300
                                 border border-emerald-100 dark:border-emerald-800"
                    >
                      <SparklesIcon className="w-3 h-3" />
                      {Math.round(paper.relevance_score)}% match
                    </span>
                  )}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                                   bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800">
                    {paper.source}
                  </span>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                {paper.authors && paper.authors.length > 0 && (
                  <span className="flex items-center gap-1">
                    <UserGroupIcon className="w-3.5 h-3.5" />
                    {paper.authors.slice(0, 3).join(', ')}
                    {paper.authors.length > 3 && ` +${paper.authors.length - 3}`}
                  </span>
                )}
                {paper.year && (
                  <span className="flex items-center gap-1">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {paper.year}
                  </span>
                )}
                {paper.doi && (
                  <span className="flex items-center gap-1">
                    <LinkIcon className="w-3.5 h-3.5" />
                    {paper.doi}
                  </span>
                )}
              </div>

              {/* Abstract */}
              {paper.abstract && (
                <div>
                  <p className={`text-sm text-gray-600 dark:text-gray-300 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
                    {paper.abstract}
                  </p>
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="text-xs text-blue-500 hover:text-blue-700 mt-1 font-medium"
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                </div>
              )}

              {/* Keywords */}
              {paper.keywords && paper.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <TagIcon className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                  {paper.keywords.slice(0, 6).map((kw, i) => (
                    <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs
                                             bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      {kw}
                    </span>
                  ))}
                  {paper.keywords.length > 6 && (
                    <span className="text-xs text-gray-400">+{paper.keywords.length - 6}</span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                {paper.download_url && (
                  <button
                    onClick={() => window.open(paper.download_url!, '_blank')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400
                               hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
                  >
                    <EyeIcon className="w-3.5 h-3.5" />
                    View paper
                  </button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function SearchPage() {
  const navigate = useNavigate()
  // Search state lives in SearchProvider (above the router) so it persists
  // across navigation and a running search keeps polling in the background.
  const {
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
  } = useSearch()

  const { startEmbeddings } = useEmbedding()

  // Filter panel open/closed is purely cosmetic — fine to keep page-local.
  const [showFilters, setShowFilters] = useState(false)

  const handleDownload = async () => {
    if (!csvFilename) return
    try {
      const blob = await filesApi.download(csvFilename)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = csvFilename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err: any) {
      setError(err.error || 'Failed to download file')
    }
  }

  const handleCreateEmbeddings = async () => {
    if (!csvFilename) return
    setError('')
    await startEmbeddings(csvFilename)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 px-4 py-8">

      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2">
        <h1 className="text-4xl font-extrabold gradient-text tracking-tight">Research Paper Search</h1>
        <p className="text-base text-gray-500 dark:text-gray-400">
          Search PubMed's full database and export results instantly.
        </p>
      </motion.div>

      {/* ── Search box ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="border border-gray-200 dark:border-gray-800 shadow-md bg-white dark:bg-gray-900">
          <CardContent className="p-5 space-y-4">

            {/* Input + button row */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                <input
                  placeholder="e.g. smart healthcare, machine learning"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSearch()}
                  disabled={isLoading}
                  className="w-full h-12 pl-11 pr-4 rounded-xl border border-gray-200 dark:border-gray-700
                             bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-inset
                             focus:ring-blue-500 disabled:opacity-50 transition"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={isLoading || !query.trim()}
                className="flex-shrink-0 h-12 px-7 rounded-xl font-semibold text-sm text-white
                           bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700
                           disabled:opacity-50 disabled:cursor-not-allowed transition-all
                           flex items-center gap-2 shadow-sm"
              >
                {isLoading ? (
                  <>
                    <Spinner className="w-4 h-4" />
                    <span>Searching…</span>
                  </>
                ) : (
                  <>
                    <MagnifyingGlassIcon className="w-4 h-4" />
                    <span>Search</span>
                  </>
                )}
              </button>
              {isLoading && (
                <button
                  onClick={handleCancel}
                  className="flex-shrink-0 h-12 px-5 rounded-xl font-semibold text-sm
                             text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800
                             bg-white dark:bg-gray-900 hover:bg-red-50 dark:hover:bg-red-900/20
                             transition-all flex items-center gap-2"
                >
                  <XCircleIcon className="w-4 h-4" />
                  <span>Cancel</span>
                </button>
              )}
            </div>

            {/* Query hint — concepts are expanded with synonyms + MeSH terms;
                separate distinct concepts with commas to AND them together. */}
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
              Tip: separate distinct concepts with commas (e.g.{' '}
              <span className="font-medium text-gray-500 dark:text-gray-400">smart healthcare, machine learning</span>).
              Each concept is auto-expanded with synonyms and MeSH terms.
            </p>

            {/* Sort mode toggle — Relevance (MedCPT semantic re-rank) vs newest-first */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Sort by:</span>
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800">
                {([
                  { mode: 'relevance' as const, label: 'Relevance', Icon: SparklesIcon },
                  { mode: 'recency' as const, label: 'Most recent', Icon: ClockIcon },
                ]).map(({ mode, label, Icon }) => {
                  const active = (filters.sortMode || 'relevance') === mode
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFilters({ ...filters, sortMode: mode })}
                      disabled={isLoading}
                      className={`inline-flex items-center gap-1 h-7 px-3 rounded-md text-xs font-semibold transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${active
                          ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  )
                })}
              </div>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 hidden sm:inline">
                {(filters.sortMode || 'relevance') === 'relevance'
                  ? 'Re-ranked by MedCPT semantic match to your query'
                  : 'Newest papers first (PubMed order)'}
              </span>
            </div>

            {/* Filter toggle row */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800
                           dark:hover:text-gray-200 transition-colors"
              >
                <FunnelIcon className="w-4 h-4" />
                {showFilters ? 'Hide filters' : 'Advanced filters'}
              </button>
              {totalResults > 0 && !isLoading && (
                <span className="text-xs text-gray-400">
                  {totalResults.toLocaleString()} papers found · page {currentPage}/{totalPages}
                </span>
              )}
            </div>

            {/* Filters panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">

                    {/* Source */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Source
                      </label>
                      <select
                        value={filters.source}
                        onChange={(e) => setFilters({ ...filters, source: e.target.value as any })}
                        className="h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700
                                   bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200
                                   focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 cursor-pointer"
                      >
                        <option value="pubmed">PubMed</option>
                      </select>
                    </div>

                    {/* Max results */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Max results
                      </label>
                      <input
                        type="number"
                        min="1"
                        placeholder="100"
                        value={filters.maxResults ?? ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value)
                          setFilters({ ...filters, maxResults: isNaN(v) || v < 1 ? undefined : v })
                        }}
                        className="h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700
                                   bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200
                                   focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                      />
                    </div>

                    <YearRangeSlider
                      startDate={filters.startDate}
                      endDate={filters.endDate}
                      onChange={({ startDate, endDate }) =>
                        setFilters({ ...filters, startDate, endDate })
                      }
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Error ── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-3xl mx-auto"
          >
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <XCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">{error}</p>
              </div>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
                <XCircleIcon className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Progress ── */}
      {isLoading && searchProgress && (
        <SearchProgressPanel progress={searchProgress} onCancel={handleCancel} />
      )}

      {/* ── Results ── */}
      {displayedResults.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

          {/* Results header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5 text-green-500" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {totalResults.toLocaleString()} Results
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownload}
                disabled={!csvFilename}
                className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold
                           border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
                           text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800
                           disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <DocumentArrowDownIcon className="w-4 h-4" />
                Export CSV
              </button>
              <button
                onClick={handleCreateEmbeddings}
                disabled={!csvFilename}
                className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold
                           bg-indigo-600 hover:bg-indigo-700 text-white
                           disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <CpuChipIcon className="w-4 h-4" />
                Create Embeddings
              </button>
              <button
                onClick={() => navigate('/analytics', { state: { filename: csvFilename, query } })}
                disabled={!csvFilename}
                className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold
                           bg-emerald-600 hover:bg-emerald-700 text-white
                           disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChartBarIcon className="w-4 h-4" />
                Open in Analytics
              </button>
            </div>
          </div>

          {/* Cards */}
          <div className="space-y-3">
            {displayedResults.map((paper, i) => (
              <PaperCard
                key={i}
                paper={paper}
                index={(currentPage - 1) * perPage + i}
              />
            ))}
          </div>

          {/* Pagination footer */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            {/* Per page */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Per page:</span>
              <select
                value={perPage}
                onChange={(e) => { setPerPage(parseInt(e.target.value)); setCurrentPage(1) }}
                disabled={isLoading}
                className="h-8 px-2 rounded-md border border-gray-200 dark:border-gray-700
                           bg-white dark:bg-gray-900 text-xs cursor-pointer
                           focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              >
                {[5, 10, 20, 50, 100, 200, 500, 1000].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {/* Page controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="h-8 w-8 rounded-lg flex items-center justify-center border border-gray-200 dark:border-gray-700
                             text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800
                             disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>

                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let p: number
                  if (totalPages <= 7) p = i + 1
                  else if (currentPage <= 4) p = i + 1
                  else if (currentPage >= totalPages - 3) p = totalPages - 6 + i
                  else p = currentPage - 3 + i
                  return (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      className={`h-8 w-8 rounded-lg text-xs font-semibold transition
                        ${currentPage === p
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                    >
                      {p}
                    </button>
                  )
                })}

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="h-8 w-8 rounded-lg flex items-center justify-center border border-gray-200 dark:border-gray-700
                             text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800
                             disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>
            )}

            <span className="text-xs text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
          </div>
        </motion.div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && displayedResults.length === 0 && allResults.length === 0 && query && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
          <MagnifyingGlassIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-gray-600 dark:text-gray-300 mb-1">No results found</h3>
          <p className="text-sm text-gray-400">Try different search terms or adjust the date range.</p>
        </motion.div>
      )}

      {/* ── Landing state ── */}
      {!isLoading && !query && displayedResults.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-center py-16"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto text-left">
            {[
              { icon: SparklesIcon, title: 'Semantic ranking', desc: 'PubMed retrieves; MedCPT re-ranks results by relevance to your query.' },
              { icon: DocumentArrowDownIcon, title: 'Export instantly', desc: 'Download all metadata as a structured CSV in one click.' },
              { icon: CpuChipIcon, title: 'AI-powered chat', desc: 'Create embeddings and ask questions about your results.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex flex-col gap-2 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                <Icon className="w-6 h-6 text-blue-500" />
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Shared embedding progress modal (same app-wide job as the Chat page) */}
      <EmbeddingProgressModal />
    </div>
  )
}
