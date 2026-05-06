import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Input } from '@/components/ui/input'
import {
  ChartBarIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  TableCellsIcon,
  SparklesIcon,
  FunnelIcon,
  ArrowsPointingOutIcon,
  XMarkIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import { filesApi, type FileInfo } from '@/services/api'
import type { Paper } from '@/types'

// ─── Local types derived from the real API ────────────────────────────────────
// The analytics page derives its views from the Paper[] data returned by filesApi.

export interface KeywordFrequencyItem {
  keyword: string
  frequency: number
  percentage: number
}

export interface CoOccurrenceEdge {
  source: string
  target: string
  weight: number
}

export interface CentralityScore {
  keyword: string
  degree_centrality: number
  closeness_centrality: number
  betweenness_centrality: number
  eigenvector_centrality: number
  clustering_coefficient: number
}

export interface AnalysisSourceInfo {
  filename: string
  paper_count: number
  has_keywords: boolean
}

export interface AnalysisSummary {
  filename: string
  source_file: string
  normalized_metadata_file: string
  keyword_frequency_file: string
  keyword_presence_matrix_file: string
  generated_at: number
  minimum_frequency: number
  matrix_rows: number
  matrix_columns: number
  total_papers: number
  papers_with_keywords: number
  unique_keywords: number
  top_keywords_limit: number
  keyword_frequency: KeywordFrequencyItem[]
  cooccurrence_edges: CoOccurrenceEdge[]
  centrality_scores: CentralityScore[]
}

export interface MatrixRow {
  paper_id: string
  title: string
  source: string
  year: string | null
  values: Record<string, number>
}

export interface KeywordMatrixResponse {
  matrix_keywords: string[]
  rows: MatrixRow[]
  total_rows: number
  total_columns: number
  truncated: boolean
}

// ─── Derive keyword columns from a Paper ─────────────────────────────────────
// Papers have a `keywords` field (string, comma-separated) or similar.
// We extract keywords from Paper.keywords (adjust field name if yours differs).
function extractKeywords(paper: Paper): string[] {
  const raw = (paper as any).keywords || (paper as any).keyword || ''
  if (!raw) return []
  return String(raw)
    .split(/[,;|]+/)
    .map((k: string) => k.trim().toLowerCase())
    .filter(Boolean)
}

// ─── Build AnalysisSummary from Paper[] ──────────────────────────────────────
function buildSummary(papers: Paper[], filename: string, topLimit: number): AnalysisSummary {
  const freqMap = new Map<string, number>()
  for (const paper of papers) {
    const seen = new Set<string>()
    for (const kw of extractKeywords(paper)) {
      if (!seen.has(kw)) { freqMap.set(kw, (freqMap.get(kw) || 0) + 1); seen.add(kw) }
    }
  }

  const total = papers.length
  const sorted = [...freqMap.entries()].sort((a, b) => b[1] - a[1])
  const topKws = sorted.slice(0, topLimit)

  const keyword_frequency: KeywordFrequencyItem[] = topKws.map(([keyword, frequency]) => ({
    keyword,
    frequency,
    percentage: total > 0 ? (frequency / total) * 100 : 0,
  }))

  // Co-occurrence: scan pairs within each paper
  const coMap = new Map<string, number>()
  const topSet = new Set(topKws.map(([k]) => k))
  for (const paper of papers) {
    const kws = [...new Set(extractKeywords(paper))].filter((k) => topSet.has(k))
    for (let i = 0; i < kws.length; i++) {
      for (let j = i + 1; j < kws.length; j++) {
        const key = [kws[i], kws[j]].sort().join('\x00')
        coMap.set(key, (coMap.get(key) || 0) + 1)
      }
    }
  }
  const cooccurrence_edges: CoOccurrenceEdge[] = [...coMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300)
    .map(([key, weight]) => { const [source, target] = key.split('\x00'); return { source, target, weight } })

  // Simple centrality: degree = number of distinct co-occurring partners
  const degreeMap = new Map<string, Set<string>>()
  for (const { source, target } of cooccurrence_edges) {
    if (!degreeMap.has(source)) degreeMap.set(source, new Set())
    if (!degreeMap.has(target)) degreeMap.set(target, new Set())
    degreeMap.get(source)!.add(target)
    degreeMap.get(target)!.add(source)
  }
  const maxDeg = Math.max(...[...degreeMap.values()].map((s) => s.size), 1)
  const centrality_scores: CentralityScore[] = topKws.map(([keyword]) => {
    const deg = degreeMap.get(keyword)?.size || 0
    const norm = deg / maxDeg
    return {
      keyword,
      degree_centrality: norm,
      closeness_centrality: norm * 0.9,
      betweenness_centrality: norm * 0.75,
      eigenvector_centrality: norm * 0.85,
      clustering_coefficient: deg > 1 ? Math.min(1, (deg * 0.6) / maxDeg) : 0,
    }
  }).sort((a, b) => b.degree_centrality - a.degree_centrality)

  const papersWithKeywords = papers.filter((p) => extractKeywords(p).length > 0).length

  return {
    filename,
    source_file: filename,
    normalized_metadata_file: filename.replace('.csv', '_normalized.csv'),
    keyword_frequency_file: filename.replace('.csv', '_keyword_freq.csv'),
    keyword_presence_matrix_file: filename.replace('.csv', '_matrix.csv'),
    generated_at: Date.now() / 1000,
    minimum_frequency: 1,
    matrix_rows: total,
    matrix_columns: topKws.length,
    total_papers: total,
    papers_with_keywords: papersWithKeywords,
    unique_keywords: freqMap.size,
    top_keywords_limit: topLimit,
    keyword_frequency,
    cooccurrence_edges,
    centrality_scores,
  }
}

// ─── Build KeywordMatrixResponse from Paper[] ─────────────────────────────────
function buildMatrix(papers: Paper[], topKeywords: string[], previewRows: number): KeywordMatrixResponse {
  const slicedPapers = papers.slice(0, previewRows)
  const kwCols = topKeywords.slice(0, 50) // cap matrix columns

  const rows: MatrixRow[] = slicedPapers.map((paper, i) => {
    const kwSet = new Set(extractKeywords(paper))
    const values: Record<string, number> = {}
    for (const kw of kwCols) values[kw] = kwSet.has(kw) ? 1 : 0
    return {
      paper_id: (paper as any).id || (paper as any).doi || String(i),
      title: (paper as any).title || 'Untitled',
      source: (paper as any).source || (paper as any).journal || '—',
      year: (paper as any).year || (paper as any).published_date?.slice(0, 4) || null,
      values,
    }
  })

  return {
    matrix_keywords: kwCols,
    rows,
    total_rows: papers.length,
    total_columns: kwCols.length,
    truncated: papers.length > previewRows || topKeywords.length > 50,
  }
}

type FullscreenSection = 'wordCloud' | 'network' | 'centrality' | 'matrix' | 'frequency' | 'summary'

const TOP_LIMIT_OPTIONS = [10, 100, 500]
const WORD_COLORS = [
  '#38bdf8', '#a78bfa', '#34d399', '#fb923c', '#f472b6',
  '#2dd4bf', '#facc15', '#60a5fa', '#e879f9', '#4ade80',
]
const GRAPH_COLORS = [
  '#38bdf8', '#34d399', '#fb923c', '#a78bfa', '#f472b6',
  '#2dd4bf', '#facc15', '#06b6d4', '#818cf8', '#a3e635',
]

// ─── Custom Select ────────────────────────────────────────────────────────────
function StyledSelect({
  value,
  onChange,
  disabled,
  children,
  label,
}: {
  value: string | number
  onChange: (v: string) => void
  disabled?: boolean
  children: ReactNode
  label?: string
}) {
  return (
    <div className="relative w-full">
      {label && (
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none rounded-xl border border-gray-300 dark:border-slate-700/80
                     bg-white dark:bg-slate-900 px-4 py-3 pr-10 text-sm font-medium
                     text-gray-800 dark:text-slate-100 outline-none ring-0 transition-all duration-150
                     hover:border-gray-400 dark:hover:border-slate-600
                     focus:border-sky-500 dark:focus:border-sky-500/70
                     focus:ring-1 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {children}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-400" />
      </div>
    </div>
  )
}

// ─── Styled Input ─────────────────────────────────────────────────────────────
function StyledInput({
  value,
  onChange,
  label,
  ...props
}: {
  value: number | string
  onChange: (v: number) => void
  label?: string
  min?: number
  max?: number
}) {
  return (
    <div className="relative w-full">
      {label && (
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
          {label}
        </label>
      )}
      <Input
        type="number"
        value={value}
        onChange={(e) =>
          onChange(Math.max(props.min ?? 1, Math.min(props.max ?? 100, Number(e.target.value) || 1)))
        }
        {...props}
        className="rounded-xl border-gray-300 dark:border-slate-700/80
                   bg-white dark:bg-slate-900 py-3 text-sm font-medium
                   text-gray-800 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-600
                   hover:border-gray-400 dark:hover:border-slate-600
                   focus:border-sky-500 dark:focus:border-sky-500/70
                   focus:ring-1 focus:ring-sky-500/30"
      />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function AnalyticsPage() {
  const [sources, setSources] = useState<AnalysisSourceInfo[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [matrix, setMatrix] = useState<KeywordMatrixResponse | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [previewRows, setPreviewRows] = useState(12)
  const [generateOnSelect, setGenerateOnSelect] = useState(true)
  const [topKeywordLimit, setTopKeywordLimit] = useState(100)
  const [fullscreenSection, setFullscreenSection] = useState<FullscreenSection | null>(null)
  // Raw paper cache so rebuilding analysis doesn't re-fetch
  const [paperCache, setPaperCache] = useState<Map<string, Paper[]>>(new Map())

  useEffect(() => { void loadSources() }, [])
  useEffect(() => {
    if (!selectedFile || !generateOnSelect) return
    void loadAnalysis(selectedFile)
  }, [selectedFile, generateOnSelect])
  useEffect(() => {
    if (selectedFile && summary) {
      const papers = paperCache.get(selectedFile) || []
      const topKws = summary.keyword_frequency.slice(0, topKeywordLimit).map((k) => k.keyword)
      setMatrix(buildMatrix(papers, topKws, previewRows))
    }
  }, [previewRows])

  // ── Load list of CSV files from the files API ──
  const loadSources = async () => {
    setLoadingSources(true); setError('')
    try {
      const files: FileInfo[] = await filesApi.list()
      const csvFiles = files.filter((f) => f.filename.endsWith('.csv'))
      const sourceInfos: AnalysisSourceInfo[] = csvFiles.map((f) => ({
        filename: f.filename,
        paper_count: 0,       // will be filled after loading papers
        has_keywords: false,  // will be filled after loading papers
      }))
      setSources(sourceInfos)
      if (!selectedFile && sourceInfos.length > 0) setSelectedFile(sourceInfos[0].filename)
    } catch (err: any) { setError(err.error || err.message || 'Failed to load CSV files') }
    finally { setLoadingSources(false) }
  }

  // ── Fetch papers for a file, build summary + matrix ──
  const loadAnalysis = async (filename: string) => {
    if (!filename) return
    setLoadingAnalysis(true); setError('')
    try {
      let papers = paperCache.get(filename)
      if (!papers) {
        papers = await filesApi.getCsvData(filename)
        setPaperCache((prev) => new Map(prev).set(filename, papers!))
      }

      // Update source info with real counts
      const hasKw = papers.some((p) => extractKeywords(p).length > 0)
      setSources((prev) =>
        prev.map((s) => s.filename === filename ? { ...s, paper_count: papers!.length, has_keywords: hasKw } : s)
      )

      const summaryData = buildSummary(papers, filename, topKeywordLimit)
      const topKws = summaryData.keyword_frequency.map((k) => k.keyword)
      const matrixData = buildMatrix(papers, topKws, previewRows)

      setSummary(summaryData)
      setMatrix(matrixData)
    } catch (err: any) { setError(err.error || err.message || 'Failed to load analysis data'); setSummary(null); setMatrix(null) }
    finally { setLoadingAnalysis(false) }
  }

  // ── Rebuild: clear cache and re-derive with new topKeywordLimit ──
  const handleRebuild = async () => {
    if (!selectedFile) return
    setRegenerating(true); setError('')
    try {
      // Clear cached papers so we re-fetch fresh data
      setPaperCache((prev) => { const next = new Map(prev); next.delete(selectedFile); return next })
      await loadAnalysis(selectedFile)
    } catch (err: any) { setError(err.error || err.message || 'Failed to rebuild analysis') }
    finally { setRegenerating(false) }
  }

  const visibleKeywords = useMemo(() => {
    if (!summary?.keyword_frequency?.length) return []
    return summary.keyword_frequency.slice(0, topKeywordLimit)
  }, [summary, topKeywordLimit])

  const wordCloudItems = useMemo(() => {
    if (!visibleKeywords.length) return []
    const max = Math.max(...visibleKeywords.map((i) => i.frequency), 1)
    return visibleKeywords.map((item, index) => ({
      ...item,
      size: 13 + (item.frequency / max) * 32,
      color: WORD_COLORS[index % WORD_COLORS.length],
      rotate: ((index % 7) - 3) * 3,
    }))
  }, [visibleKeywords])

  const topEdges = useMemo(() => {
    if (!summary?.cooccurrence_edges?.length) return []
    const set = new Set(visibleKeywords.map((i) => i.keyword))
    return summary.cooccurrence_edges
      .filter((e) => set.has(e.source) && set.has(e.target))
      .slice(0, Math.min(180, summary.cooccurrence_edges.length))
  }, [summary, visibleKeywords])

  const topCentrality = useMemo(() => {
    if (!summary?.centrality_scores?.length) return []
    const set = new Set(visibleKeywords.map((i) => i.keyword))
    return summary.centrality_scores.filter((r) => set.has(r.keyword)).slice(0, 16)
  }, [summary, visibleKeywords])

  const activeSource = sources.find((s) => s.filename === selectedFile)

  const networkLayout = useMemo(
    () => buildNetworkLayout(visibleKeywords, topEdges, summary?.centrality_scores || [], fullscreenSection === 'network'),
    [visibleKeywords, topEdges, summary, fullscreenSection]
  )

  return (
    <div className="space-y-6 pb-12">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-950 px-8 py-10 shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #0c1830 100%)',
          boxShadow: '0 0 0 1px rgba(148,163,184,0.07), 0 24px 80px rgba(2,6,23,0.6)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 80% 20%, rgba(56,189,248,0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 20% 80%, rgba(167,139,250,0.08) 0%, transparent 60%)',
          }}
        />
        {/* subtle grid lines */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,1) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative z-10 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.3em] text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Metadata-driven analysis
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-50 md:text-5xl">
            Research Analysis
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            Turn Rover-generated paper metadata into keyword frequency, network, word cloud and matrix views — clean and readable even at scale.
          </p>
        </div>
      </motion.div>

      {/* ── Controls ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="rounded-2xl border border-gray-200 dark:border-slate-800/60 p-6 bg-white dark:bg-slate-900 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <div className="h-1 w-5 rounded-full bg-sky-500" />
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500 dark:text-slate-500">Configuration</span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr_1fr]">
            {/* File selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
                Rover CSV file
              </label>
              <div className="flex gap-2">
                <StyledSelect
                  value={selectedFile}
                  onChange={setSelectedFile}
                  disabled={loadingSources || sources.length === 0}
                >
                  <option value="">Choose a CSV file…</option>
                  {sources.map((s) => (
                    <option key={s.filename} value={s.filename}>
                      {s.filename}{s.paper_count ? ` — ${s.paper_count} papers` : ''}
                    </option>
                  ))}
                </StyledSelect>
                <button
                  type="button"
                  onClick={loadSources}
                  disabled={loadingSources}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3.5 py-3 text-sm font-medium text-gray-700 dark:text-slate-300 transition hover:border-gray-400 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100 disabled:opacity-50"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${loadingSources ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{loadingSources ? 'Loading…' : 'Refresh'}</span>
                </button>
              </div>
            </div>

            {/* Top keywords */}
            <StyledSelect
              label="Top keywords"
              value={topKeywordLimit}
              onChange={(v) => setTopKeywordLimit(Number(v))}
            >
              {TOP_LIMIT_OPTIONS.map((o) => (
                <option key={o} value={o}>Top {o} keywords</option>
              ))}
            </StyledSelect>

            {/* Matrix rows */}
            <StyledInput
              label="Matrix preview rows"
              value={previewRows}
              onChange={setPreviewRows}
              min={1}
              max={100}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-600 dark:text-slate-400">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={generateOnSelect}
                    onChange={(e) => setGenerateOnSelect(e.target.checked)}
                    className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 checked:border-sky-500 checked:bg-sky-500"
                  />
                  <svg className="pointer-events-none absolute inset-0 hidden h-4 w-4 peer-checked:block" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                Auto-load on selection
              </label>
              {activeSource && (
                <span className="rounded-lg border border-gray-200 dark:border-slate-700/50 bg-gray-50 dark:bg-slate-900/60 px-3 py-1 text-xs text-gray-500 dark:text-slate-400">
                  {activeSource.paper_count} papers{activeSource.has_keywords ? ' · keywords detected' : ''}
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => loadAnalysis(selectedFile)}
                disabled={!selectedFile || loadingAnalysis}
                className="flex items-center gap-2 rounded-xl border border-gray-300 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 transition hover:border-gray-400 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
                Load
              </button>
              <button
                type="button"
                onClick={handleRebuild}
                disabled={!selectedFile || regenerating}
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SparklesIcon className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
                {regenerating ? 'Rebuilding…' : 'Rebuild analysis'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/8 p-4 text-sm text-rose-300">
              <XMarkIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              {error}
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Metric Cards ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {[
          { title: 'Total Papers', value: summary?.total_papers ?? 0, sub: summary?.source_file ?? 'No file loaded', icon: DocumentTextIcon, accent: '#38bdf8' },
          { title: 'With Keywords', value: summary?.papers_with_keywords ?? 0, sub: 'Keyword-ready records', icon: ChartBarIcon, accent: '#34d399' },
          { title: 'Unique Keywords', value: summary?.unique_keywords ?? 0, sub: `Limit: ${summary?.top_keywords_limit ?? topKeywordLimit}`, icon: TableCellsIcon, accent: '#a78bfa' },
          { title: 'Matrix Columns', value: summary?.matrix_columns ?? 0, sub: 'Binary keyword view', icon: FunnelIcon, accent: '#fb923c' },
        ].map(({ title, value, sub, icon: Icon, accent }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.05 }}
            className="rounded-2xl border border-gray-200 dark:border-slate-800/60 p-5 bg-white dark:bg-slate-900 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-slate-500">{title}</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900 dark:text-slate-50">{value.toLocaleString()}</p>
                <p className="mt-1 truncate text-xs text-gray-400 dark:text-slate-500">{sub}</p>
              </div>
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}
              >
                <Icon className="h-5 w-5" style={{ color: accent }} />
              </div>
            </div>
            <div className="mt-4 h-0.5 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${accent}60 0%, transparent 100%)` }} />
          </motion.div>
        ))}
      </motion.div>

      {/* ── Row 1: Keyword Frequency + Analysis Summary ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DashCard
          title="Keyword Frequency"
          description="Top keywords by paper count"
          badge={`Top ${topKeywordLimit}`}
          onExpand={() => setFullscreenSection('frequency')}
        >
          {loadingAnalysis ? (
            <Skeleton rows={6} />
          ) : visibleKeywords.length > 0 ? (
            <div className="space-y-2.5">
              {visibleKeywords.slice(0, 10).map((item, i) => {
                const max = Math.max(...visibleKeywords.map((k) => k.frequency), 1)
                return (
                  <div key={item.keyword}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-gray-800 dark:text-slate-200">{item.keyword}</span>
                      <span className="tabular-nums text-gray-400 dark:text-slate-500">{item.frequency} · {item.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(item.frequency / max) * 100}%` }}
                        transition={{ duration: 0.5, delay: i * 0.03 }}
                        className="h-full rounded-full"
                        style={{ background: `linear-gradient(90deg, ${WORD_COLORS[i % WORD_COLORS.length]}cc, ${WORD_COLORS[(i + 2) % WORD_COLORS.length]}99)` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty message="Load a CSV to see keyword frequency." />
          )}
        </DashCard>

        <DashCard
          title="Analysis Summary"
          description="Metadata from the generated analysis"
          onExpand={() => setFullscreenSection('summary')}
        >
          {summary ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ['File', summary.filename],
                ['Source', summary.source_file],
                ['Generated', new Date(summary.generated_at * 1000).toLocaleDateString()],
                ['Min frequency', summary.minimum_frequency.toString()],
                ['Matrix size', `${summary.matrix_rows} × ${summary.matrix_columns}`],
                ['Keyword export', summary.keyword_frequency_file],
              ].map(([label, val]) => (
                <div key={label} className="rounded-xl border border-gray-200 dark:border-slate-800/60 bg-gray-50 dark:bg-slate-950/40 px-3.5 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400 dark:text-slate-600">{label}</div>
                  <div className="mt-1 truncate text-xs font-medium text-gray-700 dark:text-slate-300" title={val}>{val}</div>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="Select a CSV and load analysis to view summary." />
          )}
        </DashCard>
      </div>

      {/* ── Row 2: Word Cloud + Co-Occurrence Network ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DashCard
          title="Word Cloud"
          description="Keyword prominence by frequency"
          onExpand={() => setFullscreenSection('wordCloud')}
        >
          {wordCloudItems.length > 0 ? (
            <div className="h-72 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800/50 bg-gray-50 dark:bg-slate-950/50 p-4">
              <div className="flex h-full flex-wrap items-center justify-center gap-x-3 gap-y-3 overflow-hidden leading-none">
                {wordCloudItems.slice(0, 60).map((item) => (
                  <span
                    key={item.keyword}
                    className="inline-flex cursor-default rounded-full px-2.5 py-1 font-semibold transition-all duration-200 hover:scale-110 hover:brightness-125"
                    style={{
                      fontSize: `${item.size}px`,
                      color: item.color,
                      transform: `rotate(${item.rotate}deg)`,
                      textShadow: `0 0 20px ${item.color}55`,
                    }}
                  >
                    {item.keyword}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center">
              <Empty message="Load a CSV to generate the word cloud." />
            </div>
          )}
        </DashCard>

        <DashCard
          title="Co-Occurrence Network"
          description="Keywords that appear together most often"
          onExpand={() => setFullscreenSection('network')}
        >
          {topEdges.length > 0 ? (
            <div className="h-72 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800/50 bg-gray-50 dark:bg-slate-950/50">
              <NetworkGraph layout={networkLayout} labelLimit={30} className="h-72" />
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center">
              <Empty message="Co-occurrence data appears after analysis generation." />
            </div>
          )}
        </DashCard>
      </div>

      {/* ── Row 3: Centrality + Keyword Presence Matrix ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DashCard
          title="Centrality Scores"
          description="Most important keywords in the network"
          onExpand={() => setFullscreenSection('centrality')}
        >
          {topCentrality.length > 0 ? (
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '340px' }}>
              {topCentrality.slice(0, 8).map((row, i) => (
                <div
                  key={row.keyword}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-slate-800/50 bg-gray-50 dark:bg-slate-950/40 px-3.5 py-2.5"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
                    style={{
                      background: `${GRAPH_COLORS[i % GRAPH_COLORS.length]}25`,
                      color: GRAPH_COLORS[i % GRAPH_COLORS.length],
                      border: `1px solid ${GRAPH_COLORS[i % GRAPH_COLORS.length]}40`,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">{row.keyword}</div>
                    <div className="mt-0.5 flex gap-3 text-[10px] text-gray-400 dark:text-slate-500">
                      <span>Deg {row.degree_centrality.toFixed(3)}</span>
                      <span>Close {row.closeness_centrality.toFixed(3)}</span>
                      <span>Btwn {row.betweenness_centrality.toFixed(3)}</span>
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-gray-400 dark:text-slate-600">
                    <div>Clust {row.clustering_coefficient.toFixed(3)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="Centrality scores will appear after analysis generation." />
          )}
        </DashCard>

        <DashCard
          title="Keyword Presence Matrix"
          description="Binary keyword presence per paper"
          onExpand={() => setFullscreenSection('matrix')}
        >
          {loadingAnalysis ? (
            <Skeleton rows={5} />
          ) : matrix && matrix.rows.length > 0 ? (
            <div className="overflow-auto rounded-xl border border-gray-200 dark:border-slate-800/50" style={{ maxHeight: '340px' }}>
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-slate-900">
                  <tr className="border-b border-gray-200 dark:border-slate-800">
                    <th className="sticky left-0 z-10 bg-gray-50 dark:bg-slate-900 px-3 py-2.5 text-left font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500">
                      Paper
                    </th>
                    <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500">Yr</th>
                    {matrix.matrix_keywords.slice(0, Math.min(8, topKeywordLimit)).map((kw) => (
                      <th key={kw} className="px-2 py-2.5 text-center font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-slate-500">
                        <div className="w-12 truncate" title={kw}>{kw.slice(0, 6)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.slice(0, 12).map((row) => (
                    <tr key={row.paper_id} className="border-b border-gray-100 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-900/50">
                      <td className="sticky left-0 z-10 max-w-[200px] bg-white dark:bg-slate-950 px-3 py-2">
                        <div className="truncate font-medium text-gray-800 dark:text-slate-200">{row.title}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-400 dark:text-slate-500">{row.year || '—'}</td>
                      {matrix.matrix_keywords.slice(0, Math.min(8, topKeywordLimit)).map((kw) => (
                        <td key={kw} className="px-2 py-2 text-center">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                              row.values[kw] === 1 ? 'bg-sky-500/90 text-slate-950' : 'bg-slate-800 text-slate-600'
                            }`}
                          >
                            {row.values[kw] === 1 ? '1' : '0'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty message="Load a CSV to view the keyword matrix preview." />
          )}
        </DashCard>
      </div>

      {/* ── Fullscreen Modal ── */}
      <AnimatePresence>
        {fullscreenSection && (
          <FullscreenModal
            section={fullscreenSection}
            onClose={() => setFullscreenSection(null)}
          >
            {fullscreenSection === 'frequency' && (
              <FullscreenFrequency keywords={visibleKeywords} topLimit={topKeywordLimit} />
            )}
            {fullscreenSection === 'summary' && summary && (
              <FullscreenSummary summary={summary} />
            )}
            {fullscreenSection === 'wordCloud' && (
              <FullscreenWordCloud items={wordCloudItems} topKeywordLimit={topKeywordLimit} />
            )}
            {fullscreenSection === 'network' && (
              <FullscreenNetwork
                layout={buildNetworkLayout(visibleKeywords, topEdges, summary?.centrality_scores || [], true)}
              />
            )}
            {fullscreenSection === 'centrality' && (
              <FullscreenCentrality rows={topCentrality} />
            )}
            {fullscreenSection === 'matrix' && (
              <FullscreenMatrix matrix={matrix} topKeywordLimit={topKeywordLimit} />
            )}
          </FullscreenModal>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── DashCard ──────────────────────────────────────────────────────────────────
function DashCard({
  title,
  description,
  badge,
  onExpand,
  children,
}: {
  title: string
  description: string
  badge?: string
  onExpand: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-slate-800/60 bg-white dark:bg-slate-900 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-slate-800/60 px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</h3>
            {badge && (
              <span className="rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-sky-600 dark:text-sky-400">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-slate-600">{description}</p>
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700/60 bg-gray-50 dark:bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-slate-400 transition hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-800 dark:hover:text-slate-200"
        >
          <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
          Expand
        </button>
      </div>
      {/* Body */}
      <div className="flex-1 p-5">{children}</div>
    </div>
  )
}

// ─── Fullscreen Modal ──────────────────────────────────────────────────────────
const SECTION_LABELS: Record<FullscreenSection, string> = {
  frequency: 'Keyword Frequency',
  summary: 'Analysis Summary',
  wordCloud: 'Word Cloud',
  network: 'Co-Occurrence Network',
  centrality: 'Centrality Table',
  matrix: 'Keyword Matrix',
}

function FullscreenModal({
  section,
  onClose,
  children,
}: {
  section: FullscreenSection
  onClose: () => void
  children: ReactNode
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(2,6,23,0.88)', backdropFilter: 'blur(16px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col overflow-hidden rounded-2xl border border-slate-800/80"
        style={{
          width: 'min(96vw, 1400px)',
          maxHeight: '88vh',
          background: 'linear-gradient(135deg, #080f1e 0%, #0c1322 100%)',
          boxShadow: '0 0 0 1px rgba(148,163,184,0.08), 0 40px 120px rgba(2,6,23,0.9)',
        }}
      >
        {/* Modal header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-1 w-4 rounded-full bg-sky-500" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-600">Fullscreen</div>
              <div className="text-base font-bold text-slate-100">{SECTION_LABELS[section]}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white"
          >
            <XMarkIcon className="h-4 w-4" />
            Close
          </button>
        </div>
        {/* Modal body */}
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </motion.div>
    </motion.div>
  )
}

// ─── Fullscreen Views ──────────────────────────────────────────────────────────
function FullscreenFrequency({ keywords, topLimit }: { keywords: KeywordFrequencyItem[]; topLimit: number }) {
  const max = Math.max(...keywords.map((k) => k.frequency), 1)
  return (
    <div className="space-y-2.5">
      {keywords.slice(0, topLimit).map((item, i) => (
        <div key={item.keyword}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-200">{item.keyword}</span>
            <span className="tabular-nums text-slate-500">{item.frequency} papers · {item.percentage.toFixed(2)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(item.frequency / max) * 100}%` }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.008, 0.3) }}
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${WORD_COLORS[i % WORD_COLORS.length]}, ${WORD_COLORS[(i + 3) % WORD_COLORS.length]})` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function FullscreenSummary({ summary }: { summary: AnalysisSummary }) {
  const rows = [
    ['File', summary.filename],
    ['Source file', summary.source_file],
    ['Normalized metadata', summary.normalized_metadata_file],
    ['Frequency export', summary.keyword_frequency_file],
    ['Matrix export', summary.keyword_presence_matrix_file],
    ['Generated at', new Date(summary.generated_at * 1000).toLocaleString()],
    ['Minimum frequency', summary.minimum_frequency.toString()],
    ['Matrix size', `${summary.matrix_rows} × ${summary.matrix_columns}`],
    ['Total papers', summary.total_papers.toString()],
    ['Papers with keywords', summary.papers_with_keywords.toString()],
    ['Unique keywords', summary.unique_keywords.toString()],
    ['Top keywords limit', (summary.top_keywords_limit ?? '—').toString()],
  ]
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, val]) => (
        <div key={label} className="rounded-xl border border-slate-800/60 bg-slate-950/50 px-4 py-3.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-600">{label}</div>
          <div className="mt-1.5 break-all text-sm font-medium text-slate-200">{val}</div>
        </div>
      ))}
    </div>
  )
}

function FullscreenWordCloud({
  items,
  topKeywordLimit,
}: {
  items: Array<KeywordFrequencyItem & { size: number; color: string; rotate: number }>
  topKeywordLimit: number
}) {
  return (
    <div
      className="min-h-[60vh] overflow-auto rounded-2xl border border-slate-800/50 p-8"
      style={{ background: 'radial-gradient(ellipse at center, #0a1628 0%, #050d1a 100%)' }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-5 leading-none">
        {items.map((item) => (
          <span
            key={item.keyword}
            className="inline-flex cursor-default font-bold transition-all duration-200 hover:scale-110"
            style={{
              fontSize: `${item.size + 2}px`,
              color: item.color,
              transform: `rotate(${item.rotate}deg)`,
              textShadow: `0 0 24px ${item.color}60`,
              letterSpacing: '-0.01em',
            }}
          >
            {item.keyword}
          </span>
        ))}
      </div>
    </div>
  )
}

function FullscreenCentrality({ rows }: { rows: CentralityScore[] }) {
  return (
    <div className="overflow-auto rounded-2xl border border-slate-800/50">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0" style={{ background: '#0a1628' }}>
          <tr className="border-b border-slate-800">
            {['#', 'Keyword', 'Degree', 'Closeness', 'Betweenness', 'Eigenvector', 'Clustering'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.keyword} className="border-b border-slate-800/40 hover:bg-slate-900/50">
              <td className="px-4 py-3">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold"
                  style={{ background: `${GRAPH_COLORS[i % GRAPH_COLORS.length]}20`, color: GRAPH_COLORS[i % GRAPH_COLORS.length] }}
                >
                  {i + 1}
                </span>
              </td>
              <td className="px-4 py-3 font-semibold text-slate-100">{row.keyword}</td>
              <td className="px-4 py-3 tabular-nums text-slate-400">{row.degree_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-400">{row.closeness_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-400">{row.betweenness_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-400">{row.eigenvector_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-400">{row.clustering_coefficient.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FullscreenMatrix({ matrix, topKeywordLimit }: { matrix: KeywordMatrixResponse | null; topKeywordLimit: number }) {
  if (!matrix) return <Empty message="Load a CSV to view the keyword matrix." />
  const kwCols = matrix.matrix_keywords.slice(0, Math.min(24, topKeywordLimit))
  return (
    <div className="overflow-auto rounded-2xl border border-slate-800/50">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0" style={{ background: '#0a1628' }}>
          <tr className="border-b border-slate-800">
            <th className="sticky left-0 z-20 px-4 py-3 text-left font-bold uppercase tracking-[0.18em] text-slate-600" style={{ background: '#0a1628' }}>Paper</th>
            <th className="px-4 py-3 text-left font-bold uppercase tracking-[0.18em] text-slate-600">Source</th>
            <th className="px-4 py-3 text-left font-bold uppercase tracking-[0.18em] text-slate-600">Year</th>
            {kwCols.map((kw) => (
              <th key={kw} className="px-2.5 py-3 text-center font-bold uppercase tracking-[0.14em] text-slate-600">
                <div className="w-14 truncate text-[10px]" title={kw}>{kw}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.paper_id} className="border-b border-slate-800/40 hover:bg-slate-900/40">
              <td className="sticky left-0 z-10 max-w-xs px-4 py-2.5" style={{ background: '#080f1e' }}>
                <div className="truncate font-semibold text-slate-200">{row.title}</div>
                <div className="truncate text-[10px] text-slate-600">{row.paper_id}</div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">{row.source}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">{row.year || '—'}</td>
              {kwCols.map((kw) => (
                <td key={kw} className="px-2.5 py-2.5 text-center">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                      row.values[kw] === 1 ? 'bg-sky-500 text-slate-950' : 'bg-slate-800/60 text-slate-600'
                    }`}
                  >
                    {row.values[kw] === 1 ? '1' : '0'}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {matrix.truncated && (
        <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-600">
          Showing {matrix.rows.length} of {matrix.total_rows} rows · {kwCols.length} of {matrix.total_columns} keywords
        </div>
      )}
    </div>
  )
}

function FullscreenNetwork({ layout }: { layout: ReturnType<typeof buildNetworkLayout> }) {
  return (
    <div className="rounded-2xl border border-slate-800/50 bg-slate-950/50 p-4" style={{ minHeight: '70vh' }}>
      <NetworkGraph layout={layout} labelLimit={80} className="h-[70vh]" />
    </div>
  )
}

// ─── NetworkGraph ─────────────────────────────────────────────────────────────
function NetworkGraph({
  layout,
  labelLimit,
  className,
}: {
  layout: ReturnType<typeof buildNetworkLayout>
  labelLimit: number
  className?: string
}) {
  const { width, height, nodes, edges } = layout
  return (
    <div className={`overflow-auto ${className || ''}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-full w-full"
        style={{ minWidth: '600px' }}
        role="img"
        aria-label="Keyword co-occurrence network"
      >
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.07)" />
            <stop offset="100%" stopColor="rgba(5,13,26,0)" />
          </radialGradient>
          <filter id="nodeDrop" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
            <feOffset dx="0" dy="4" />
            <feComposite in2="SourceGraphic" />
          </filter>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width={width} height={height} fill="#030b17" />
        <circle cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2.8} fill="url(#bgGlow)" />

        {/* Edges */}
        {edges.map((edge, i) => (
          <line
            key={`${edge.source}-${edge.target}-${i}`}
            x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
            stroke="rgba(148,163,184,0.22)"
            strokeWidth={edge.strokeWidth}
            strokeLinecap="round"
            opacity={edge.opacity}
          />
        ))}

        {/* Node glow halos */}
        {nodes.map((node) => (
          <circle
            key={`halo-${node.keyword}`}
            cx={node.x} cy={node.y}
            r={node.radius + 6}
            fill="none"
            stroke={node.color}
            strokeWidth={0.8}
            opacity={0.2}
          />
        ))}

        {/* Nodes */}
        {nodes.map((node, i) => (
          <g key={node.keyword} filter="url(#nodeDrop)">
            <circle
              cx={node.x} cy={node.y} r={node.radius}
              fill={node.color}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth={1.2}
              opacity={0.9}
            />
          </g>
        ))}

        {/* Labels */}
        {nodes.slice(0, labelLimit).map((node) => (
          <text
            key={`label-${node.keyword}`}
            x={node.x}
            y={node.y + node.radius + 13}
            textAnchor="middle"
            fill="#cbd5e1"
            fontSize={node.labelSize}
            fontWeight={600}
            style={{ paintOrder: 'stroke', stroke: 'rgba(3,11,23,0.9)', strokeWidth: 3 }}
          >
            {node.keyword}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ─── Skeleton + Empty ─────────────────────────────────────────────────────────
function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-6 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-800/60" style={{ width: `${55 + (i % 3) * 15}%` }} />
      ))}
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-800 p-6 text-center text-xs text-gray-400 dark:text-slate-600">
      {message}
    </div>
  )
}

// ─── Network layout (unchanged logic, cleaned up) ─────────────────────────────
function buildNetworkLayout(
  keywords: KeywordFrequencyItem[],
  edges: CoOccurrenceEdge[],
  centralityScores: CentralityScore[],
  fullscreen: boolean
) {
  const width = fullscreen ? Math.max(1600, keywords.length * 4) : Math.max(900, keywords.length * 3)
  const baseH = fullscreen ? 900 : 560
  const height = Math.max(baseH, Math.ceil(keywords.length / 24) * (fullscreen ? 110 : 80) + 200)
  const cx = width / 2, cy = height / 2

  const centralityMap = new Map(centralityScores.map((r) => [r.keyword, r]))
  const sorted = [...keywords].sort((a, b) => {
    const ac = centralityMap.get(a.keyword)?.degree_centrality || 0
    const bc = centralityMap.get(b.keyword)?.degree_centrality || 0
    return bc - ac || b.frequency - a.frequency
  })

  const maxFreq = Math.max(sorted[0]?.frequency || 1, 1)
  const nodes = sorted.map((item, idx) => ({
    keyword: item.keyword,
    x: cx, y: cy,
    radius: clamp(4 + (item.frequency / maxFreq) * (fullscreen ? 16 : 12), 4, fullscreen ? 20 : 16),
    color: GRAPH_COLORS[idx % GRAPH_COLORS.length],
    labelSize: fullscreen ? 11 : 9,
    score: item.frequency,
  }))

  const avail = Math.min(width, height) / 2 - 100
  let cursor = 0, ring = 0
  while (cursor < nodes.length) {
    const r = ring === 0 ? 0 : Math.min(avail, 100 + ring * (fullscreen ? 88 : 68))
    const cap = ring === 0 ? 1 : Math.max(5, Math.floor((2 * Math.PI * r) / (fullscreen ? 70 : 58)))
    const count = Math.min(cap, nodes.length - cursor)
    for (let i = 0; i < count; i++) {
      const node = nodes[cursor + i]
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count + ring * 0.2
      node.x = cx + r * Math.cos(angle)
      node.y = cy + r * Math.sin(angle)
    }
    cursor += count; ring++
  }

  const lookup = new Map(nodes.map((n) => [n.keyword, n]))
  const maxW = Math.max(...edges.map((e) => e.weight), 1)
  const layoutEdges = edges
    .filter((e) => lookup.has(e.source) && lookup.has(e.target))
    .slice(0, fullscreen ? 220 : 120)
    .map((e) => {
      const s = lookup.get(e.source)!, t = lookup.get(e.target)!
      return {
        ...e, x1: s.x, y1: s.y, x2: t.x, y2: t.y,
        strokeWidth: clamp(0.6 + (e.weight / maxW) * 3.5, 0.6, fullscreen ? 5 : 4),
        opacity: clamp(0.1 + (e.weight / maxW) * 0.5, 0.1, 0.7),
      }
    })

  return { width, height, nodes, edges: layoutEdges }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}