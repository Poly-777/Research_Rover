import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useLocation } from 'react-router-dom'
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
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { useTheme } from '@/components/theme-provider'
import { filesApi, analysisApi, type FileInfo } from '@/services/api'
import { useAnalytics } from '@/context/AnalyticsContext'
import type {
  KeywordFrequencyItem,
  CoOccurrenceEdge,
  CentralityScore,
  AnalysisSourceInfo,
  AnalysisSummary,
  MatrixRow,
  KeywordMatrixResponse,
} from '@/types'

// Analytics view types live in '@/types' (shared with the API layer). They are
// re-exported here so AnalyticsContext's existing import path keeps working.
export type {
  KeywordFrequencyItem,
  CoOccurrenceEdge,
  CentralityScore,
  AnalysisSourceInfo,
  AnalysisSummary,
  MatrixRow,
  KeywordMatrixResponse,
}


// ─── Download helpers for analysis outputs ────────────────────────────────────
// All analysis is computed in the browser, so the downloadable files are also
// built here and saved straight to the user's machine — no backend call needed.
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\n')
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Prepend a UTF-8 BOM so Excel reads non-ASCII keywords correctly
// (without it "indo‑aryan" shows up as "indoâaryan").
function downloadCSV(filename: string, csv: string) {
  downloadFile(filename, '﻿' + csv, 'text/csv;charset=utf-8')
}

function downloadJSON(filename: string, data: unknown) {
  downloadFile(filename, JSON.stringify(data, null, 2), 'application/json')
}

// Serialize a self-contained <svg>, rasterize it through a <canvas>, save a PNG.
// The SVG must paint its own background <rect> or the PNG will be transparent.
function svgToPng(
  svg: SVGSVGElement | null,
  filename: string,
  onError?: () => void,
  scale = 2,
) {
  if (!svg) { onError?.(); return }
  const xml = new XMLSerializer().serializeToString(svg)
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  img.onload = () => {
    const vb = svg.viewBox.baseVal
    const w = (vb && vb.width) || svg.clientWidth || 1200
    const h = (vb && vb.height) || svg.clientHeight || 800
    const canvas = document.createElement('canvas')
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) { URL.revokeObjectURL(svgUrl); onError?.(); return }
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(svgUrl)
    canvas.toBlob((blob) => {
      if (!blob) { onError?.(); return }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }
  img.onerror = () => { URL.revokeObjectURL(svgUrl); onError?.() }
  img.src = svgUrl
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

// ─── Theme-aware tokens for the network + word cloud ─────────────────────────
type ThemeMode = 'light' | 'dark'

const NETWORK_THEME: Record<ThemeMode, {
  bg: string
  edge: string
  label: string
  labelStroke: string
  nodeStroke: string
}> = {
  dark: {
    bg: '#030b17',
    // Fully opaque — final visibility is governed by edge.opacity * depthFade
    // (was rgba(...,0.22), which compounded down to <2% effective alpha).
    edge: '#94a3b8',
    label: '#cbd5e1',
    labelStroke: 'rgba(3,11,23,0.9)',
    nodeStroke: 'rgba(255,255,255,0.2)',
  },
  light: {
    bg: '#f8fafc',
    edge: '#334155',
    label: '#1e293b',
    labelStroke: 'rgba(255,255,255,0.92)',
    nodeStroke: 'rgba(15,23,42,0.25)',
  },
}

const WORDCLOUD_BG: Record<ThemeMode, string> = {
  dark: '#050d1a',
  light: '#ffffff',
}

// Earthy "Wordle" palette for light theme; brighter greens for dark theme.
const WORDCLOUD_COLORS: Record<ThemeMode, string[]> = {
  light: ['#1f5014', '#3d7a1f', '#6b8e23', '#8a9a2b', '#4d6b1a', '#2f6b35', '#7d6b14', '#556b2f', '#3b5323', '#6b4c1a'],
  dark: ['#4ade80', '#34d399', '#a3e635', '#86efac', '#22c55e', '#bef264', '#5eead4', '#facc15', '#84cc16', '#10b981'],
}

interface WordCloudWord {
  keyword: string
  frequency: number
  size: number          // font size in viewBox units
  rotate: 0 | 90
  colorIndex: number
}

// ─── Custom Select ────────────────────────────────────────────────────────────
function StyledSelect({
  value,
  onChange,
  disabled,
  children,
  label,
  icon,
}: {
  value: string | number
  onChange: (v: string) => void
  disabled?: boolean
  children: ReactNode
  label?: string
  icon?: ReactNode
}) {
  return (
    <div className="relative w-full">
      {label && (
        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
          {icon && <span className="text-sky-500/80 dark:text-sky-400/80">{icon}</span>}
          {label}
        </label>
      )}
      <div className="group relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="relative w-full appearance-none rounded-xl border border-gray-300 dark:border-slate-700/80
                     bg-gradient-to-b from-white to-gray-50/70 dark:from-slate-900 dark:to-slate-900/40
                     px-4 py-3 pr-12 text-sm font-medium
                     text-gray-800 dark:text-slate-100 outline-none ring-0 shadow-sm transition-all duration-200
                     hover:border-sky-400/70 hover:shadow-md hover:shadow-sky-500/5
                     dark:hover:border-sky-500/50 dark:hover:shadow-sky-500/10
                     focus:border-sky-500 dark:focus:border-sky-500/80
                     focus:shadow-[0_0_0_3px_rgba(56,189,248,0.18)]
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {children}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg bg-gray-100/80 text-gray-500 transition-colors duration-150 group-hover:bg-sky-500/10 group-hover:text-sky-600 dark:bg-slate-800/80 dark:text-slate-400 dark:group-hover:bg-sky-500/15 dark:group-hover:text-sky-300">
          <ChevronDownIcon className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

// ─── Top-keywords control: presets + custom number input ─────────────────────
function TopKeywordControl({
  value,
  onChange,
  presets,
}: {
  value: number
  onChange: (v: number) => void
  presets: number[]
}) {
  const isPreset = presets.includes(value)
  const [draft, setDraft] = useState(isPreset ? '' : String(value))
  useEffect(() => {
    if (!presets.includes(value)) setDraft(String(value))
    else setDraft('')
  }, [value, presets])

  const commit = (raw: string) => {
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n) || n < 1) return
    onChange(Math.max(1, Math.min(5000, n)))
  }

  return (
    <div className="w-full">
      <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
        <SparklesIcon className="h-3.5 w-3.5 text-sky-500/80 dark:text-sky-400/80" />
        Top keywords
      </label>
      <div className="flex items-stretch gap-1 rounded-xl border border-gray-300 bg-gradient-to-b from-white to-gray-50/70 p-1 shadow-sm dark:border-slate-700/80 dark:from-slate-900 dark:to-slate-900/40">
        {presets.map((p) => {
          const active = value === p
          return (
            <button
              type="button"
              key={p}
              onClick={() => onChange(p)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all duration-200 ${
                active
                  ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-md shadow-sky-500/30'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              }`}
            >
              {p}
            </button>
          )
        })}
        <div
          className={`flex items-center gap-1.5 rounded-lg px-2 transition-colors ${
            !isPreset
              ? 'bg-gradient-to-br from-sky-500/15 to-indigo-500/10 ring-1 ring-inset ring-sky-500/40'
              : 'hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
              !isPreset ? 'text-sky-600 dark:text-sky-300' : 'text-gray-500 dark:text-slate-400'
            }`}
          >
            Custom
          </span>
          <input
            type="number"
            min={1}
            max={5000}
            value={draft}
            placeholder="N"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft && commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
            }}
            className="w-14 bg-transparent py-1 text-center text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400 dark:text-slate-100 dark:placeholder:text-slate-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Styled Input ─────────────────────────────────────────────────────────────
function StyledInput({
  value,
  onChange,
  label,
  icon,
  ...props
}: {
  value: number | string
  onChange: (v: number) => void
  label?: string
  icon?: ReactNode
  min?: number
  max?: number
}) {
  return (
    <div className="relative w-full">
      {label && (
        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
          {icon && <span className="text-sky-500/80 dark:text-sky-400/80">{icon}</span>}
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
                   bg-gradient-to-b from-white to-gray-50/70 dark:from-slate-900 dark:to-slate-900/40
                   py-3 text-sm font-medium shadow-sm
                   text-gray-800 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-600
                   transition-all duration-200
                   hover:border-sky-400/70 hover:shadow-md hover:shadow-sky-500/5
                   dark:hover:border-sky-500/50 dark:hover:shadow-sky-500/10
                   focus:border-sky-500 dark:focus:border-sky-500/80
                   focus:shadow-[0_0_0_3px_rgba(56,189,248,0.18)] focus-visible:ring-0"
      />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function AnalyticsPage() {
  const { theme } = useTheme()
  // When opened from the Search page's "Open in Analytics" button, the CSV
  // filename (and the term that was searched) arrive via navigation state so
  // we can pre-select that file instead of defaulting to the first one.
  const location = useLocation()
  const requestedFile = (location.state as { filename?: string } | null)?.filename
  // Data-bearing state lives in context so it survives navigating away and back.
  const {
    sources, setSources,
    selectedFile, setSelectedFile,
    summary, setSummary,
    matrix, setMatrix,
    previewRows, setPreviewRows,
    generateOnSelect, setGenerateOnSelect,
    topKeywordLimit, setTopKeywordLimit,
  } = useAnalytics()
  // Transient UI state stays local — fine to reset on navigation.
  const [loadingSources, setLoadingSources] = useState(false)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [fullscreenSection, setFullscreenSection] = useState<FullscreenSection | null>(null)
  // SVG refs for in-card PNG export
  const wordCloudCardSvgRef = useRef<SVGSVGElement | null>(null)
  const networkCardSvgRef = useRef<SVGSVGElement | null>(null)
  // Hidden file input for the "Upload CSV" button
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  // Load the file list once; skip if already loaded (e.g. returning to the page).
  useEffect(() => { if (sources.length === 0) void loadSources() }, [])
  // Honor a file passed from the Search page's "Open in Analytics", even on return.
  useEffect(() => {
    if (requestedFile && sources.some((s) => s.filename === requestedFile)) {
      setSelectedFile(requestedFile)
    }
  }, [requestedFile, sources])
  useEffect(() => {
    if (!selectedFile || !generateOnSelect) return
    // Already computed for this file (persisted in context) — don't refetch.
    if (summary?.filename === selectedFile && matrix) return
    void loadAnalysis(selectedFile)
  }, [selectedFile, generateOnSelect])
  // Re-fetch just the matrix preview from the backend when the row count changes.
  useEffect(() => {
    if (!selectedFile || !summary) return
    let cancelled = false
    analysisApi.getMatrix(selectedFile, previewRows)
      .then((m) => { if (!cancelled) setMatrix(m) })
      .catch(() => {})
    return () => { cancelled = true }
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
      // Prefer the file passed from the Search page, if it exists in the list;
      // otherwise fall back to the first available file.
      if (requestedFile && sourceInfos.some((s) => s.filename === requestedFile)) {
        setSelectedFile(requestedFile)
      } else if (!selectedFile && sourceInfos.length > 0) {
        setSelectedFile(sourceInfos[0].filename)
      }
    } catch (err: any) { setError(err.error || err.message || 'Failed to load CSV files') }
    finally { setLoadingSources(false) }
  }

  // ── Upload a user-provided CSV, then refresh sources and select it ──
  const handleUploadFile = async (file: File | undefined | null) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Only .csv files are supported')
      return
    }
    setUploading(true); setError('')
    try {
      const res = await filesApi.upload(file)
      toast.success(`Uploaded ${res.filename}`)
      // Refresh source list and select the newly uploaded file. The list
      // refresh is in-line (rather than calling loadSources()) so we can read
      // the fresh list synchronously to decide what to select.
      const files: FileInfo[] = await filesApi.list()
      const csvFiles = files.filter((f) => f.filename.endsWith('.csv'))
      setSources(csvFiles.map((f) => ({
        filename: f.filename, paper_count: 0, has_keywords: false,
      })))
      setSelectedFile(res.filename)
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.error || err?.message || 'Upload failed'
      setError(detail)
      toast.error(detail)
    } finally {
      setUploading(false)
      // Clear the input so picking the same file again re-fires onChange.
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  // ── Run the real backend analysis (AnalysisService): keyword frequency,
  //    co-occurrence graph, and networkx centralities (degree, closeness,
  //    betweenness, eigenvector, clustering). ──
  const loadAnalysis = async (filename: string) => {
    if (!filename) return
    setLoadingAnalysis(true); setError('')
    try {
      const summaryData = await analysisApi.generate({
        filename,
        top_keywords: topKeywordLimit,
        minimum_frequency: 1,
        refresh: true,
      })
      const matrixData = await analysisApi.getMatrix(filename, previewRows)

      // Update source info with the backend's real counts.
      setSources((prev) =>
        prev.map((s) => s.filename === filename
          ? { ...s, paper_count: summaryData.total_papers, has_keywords: summaryData.papers_with_keywords > 0 }
          : s)
      )

      setSummary(summaryData)
      setMatrix(matrixData)
    } catch (err: any) { setError(err.error || err.message || 'Failed to load analysis data'); setSummary(null); setMatrix(null) }
    finally { setLoadingAnalysis(false) }
  }

  // ── Rebuild: re-run the backend analysis (refresh=true) for this file. ──
  const handleRebuild = async () => {
    if (!selectedFile) return
    setRegenerating(true); setError('')
    try {
      await loadAnalysis(selectedFile)
    } catch (err: any) { setError(err.error || err.message || 'Failed to rebuild analysis') }
    finally { setRegenerating(false) }
  }

  // ── Per-card download handlers ──
  // Each card exports in the format that suits it: data cards → CSV/JSON,
  // visual cards → PNG (rasterized from their own SVG).
  const downloadBase = (selectedFile || 'analysis').replace(/\.csv$/i, '')

  const handleDownloadFrequency = () => {
    if (!visibleKeywords.length) { toast.error('Load an analysis first.'); return }
    downloadCSV(
      `${downloadBase}_keyword_frequency.csv`,
      toCSV(
        ['keyword', 'frequency', 'percentage'],
        visibleKeywords.map((k) => [k.keyword, k.frequency, k.percentage.toFixed(2)]),
      ),
    )
    toast.success('Keyword frequency CSV downloaded')
  }

  const handleDownloadCentrality = () => {
    if (!topCentrality.length) { toast.error('Load an analysis first.'); return }
    downloadCSV(
      `${downloadBase}_centrality.csv`,
      toCSV(
        ['keyword', 'degree_centrality', 'closeness_centrality', 'betweenness_centrality', 'eigenvector_centrality', 'clustering_coefficient'],
        topCentrality.map((c) => [
          c.keyword,
          c.degree_centrality.toFixed(4),
          c.closeness_centrality.toFixed(4),
          c.betweenness_centrality.toFixed(4),
          c.eigenvector_centrality.toFixed(4),
          c.clustering_coefficient.toFixed(4),
        ]),
      ),
    )
    toast.success('Centrality scores CSV downloaded')
  }

  const handleDownloadMatrix = () => {
    if (!matrix?.rows.length) { toast.error('Load an analysis first.'); return }
    const headers = ['paper_id', 'title', 'source', 'year', ...matrix.matrix_keywords]
    const rows = matrix.rows.map((r) => [
      r.paper_id,
      r.title,
      r.source,
      r.year ?? '',
      ...matrix.matrix_keywords.map((kw) => r.values[kw] ?? 0),
    ])
    downloadCSV(`${downloadBase}_keyword_matrix.csv`, toCSV(headers, rows))
    toast.success('Keyword matrix CSV downloaded')
  }

  const handleDownloadSummary = () => {
    if (!summary) { toast.error('Load an analysis first.'); return }
    // The summary JSON also embeds the co-occurrence edges, centrality scores
    // and keyword frequency arrays, so all derived data is preserved here.
    downloadJSON(`${downloadBase}_analysis_summary.json`, summary)
    toast.success('Analysis summary JSON downloaded')
  }

  const handleDownloadWordCloud = () => {
    if (!wordCloudItems.length) { toast.error('Load an analysis first.'); return }
    svgToPng(
      wordCloudCardSvgRef.current,
      `${downloadBase}_word_cloud.png`,
      () => toast.error('Could not export the word cloud image'),
    )
    toast.success('Word cloud PNG downloaded')
  }

  const handleDownloadNetwork = () => {
    if (!networkLayout.nodes.length) { toast.error('Load an analysis first.'); return }
    svgToPng(
      networkCardSvgRef.current,
      `${downloadBase}_cooccurrence_network.png`,
      () => toast.error('Could not export the network image'),
    )
    toast.success('Network PNG downloaded')
  }

  const visibleKeywords = useMemo(() => {
    if (!summary?.keyword_frequency?.length) return []
    return summary.keyword_frequency.slice(0, topKeywordLimit)
  }, [summary, topKeywordLimit])

  const wordCloudItems = useMemo<WordCloudWord[]>(() => {
    if (!visibleKeywords.length) return []
    // Cap at 150 — beyond that words are unreadably small anyway.
    const capped = visibleKeywords.slice(0, 150)
    const max = Math.max(...capped.map((i) => i.frequency), 1)
    return capped.map((item, index) => ({
      keyword: item.keyword,
      frequency: item.frequency,
      // Wide size range so the most frequent word dominates the centre.
      size: 16 + (item.frequency / max) * 72,
      // Deterministic ~1/3 of words rotated vertically; index 0 stays horizontal.
      rotate: index % 3 === 1 ? 90 : 0,
      colorIndex: index,
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
    () => buildSphereLayout(visibleKeywords, topEdges, summary?.centrality_scores || [], false),
    [visibleKeywords, topEdges, summary]
  )

  return (
    <div className="space-y-6 pb-12">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-slate-800/60 px-8 py-10 shadow-sm dark:shadow-2xl"
        style={{
          background:
            theme === 'dark'
              ? 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #0c1830 100%)'
              : 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #e0f2fe 100%)',
          boxShadow:
            theme === 'dark'
              ? '0 0 0 1px rgba(148,163,184,0.07), 0 24px 80px rgba(2,6,23,0.6)'
              : '0 0 0 1px rgba(148,163,184,0.12), 0 12px 40px rgba(15,23,42,0.08)',
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
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-slate-50 md:text-5xl">
            Research Analysis
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-slate-400">
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1.4fr_1fr]">
            {/* File selector */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
                <DocumentTextIcon className="h-3.5 w-3.5 text-sky-500/80 dark:text-sky-400/80" />
                Rover CSV file
              </label>
              <div className="flex gap-2">
                <StyledSelect
                  value={selectedFile}
                  onChange={setSelectedFile}
                  disabled={loadingSources || sources.length === 0}
                >
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
                  title="Refresh CSV list"
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 dark:border-slate-700/80 bg-gradient-to-b from-white to-gray-50/70 dark:from-slate-900 dark:to-slate-900/40 px-3.5 py-3 text-sm font-medium text-gray-700 dark:text-slate-300 shadow-sm transition hover:border-sky-400/70 hover:shadow-md hover:shadow-sky-500/5 hover:text-gray-900 dark:hover:border-sky-500/50 dark:hover:text-slate-100 disabled:opacity-50"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${loadingSources ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{loadingSources ? 'Loading…' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                  title="Upload your own CSV"
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 px-3.5 py-3 text-sm font-semibold text-white shadow-md shadow-sky-500/25 transition hover:from-sky-400 hover:to-indigo-400 hover:shadow-lg hover:shadow-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowUpTrayIcon className={`h-4 w-4 ${uploading ? 'animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">{uploading ? 'Uploading…' : 'Upload CSV'}</span>
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleUploadFile(e.target.files?.[0])}
                />
              </div>
            </div>

            {/* Top keywords — presets + custom */}
            <TopKeywordControl
              value={topKeywordLimit}
              onChange={setTopKeywordLimit}
              presets={TOP_LIMIT_OPTIONS}
            />

            {/* Matrix rows */}
            <StyledInput
              label="Matrix preview rows"
              icon={<TableCellsIcon className="h-3.5 w-3.5" />}
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
          onDownload={handleDownloadFrequency}
          downloadDisabled={!visibleKeywords.length}
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
          onDownload={handleDownloadSummary}
          downloadDisabled={!summary}
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
          onDownload={handleDownloadWordCloud}
          downloadDisabled={!wordCloudItems.length}
        >
          {wordCloudItems.length > 0 ? (
            <div className="h-72 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800/50">
              <WordCloudSvg
                items={wordCloudItems}
                theme={theme}
                svgRef={wordCloudCardSvgRef}
                className="h-full w-full"
                interactive
              />
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center">
              <Empty message="Load a CSV to generate the word cloud." />
            </div>
          )}
        </DashCard>

        <DashCard
          title="Co-Occurrence Network"
          description="Drag to rotate · scroll to zoom"
          onExpand={() => setFullscreenSection('network')}
          onDownload={handleDownloadNetwork}
          downloadDisabled={!networkLayout.nodes.length}
        >
          {topEdges.length > 0 ? (
            <div className="h-72 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800/50">
              <NetworkGraph
                layout={networkLayout}
                labelLimit={30}
                theme={theme}
                svgRef={networkCardSvgRef}
                className="h-72"
              />
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
          onDownload={handleDownloadCentrality}
          downloadDisabled={!topCentrality.length}
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
          onDownload={handleDownloadMatrix}
          downloadDisabled={!matrix?.rows.length}
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
                              row.values[kw] === 1
                                ? 'bg-sky-500/90 text-white dark:text-slate-950'
                                : 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-600'
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
              <FullscreenWordCloud
                items={wordCloudItems}
                theme={theme}
                downloadName={`${downloadBase}_word_cloud.png`}
              />
            )}
            {fullscreenSection === 'network' && (
              <FullscreenNetwork
                layout={buildSphereLayout(visibleKeywords, topEdges, summary?.centrality_scores || [], true)}
                theme={theme}
                downloadName={`${downloadBase}_cooccurrence_network.png`}
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
  onDownload,
  downloadDisabled,
  children,
}: {
  title: string
  description: string
  badge?: string
  onExpand: () => void
  onDownload?: () => void
  downloadDisabled?: boolean
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
        <div className="flex items-center gap-2">
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloadDisabled}
              title="Download this card"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700/60 bg-gray-50 dark:bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-slate-400 transition hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-800 dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              Download
            </button>
          )}
          <button
            type="button"
            onClick={onExpand}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700/60 bg-gray-50 dark:bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-slate-400 transition hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-800 dark:hover:text-slate-200"
          >
            <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
            Expand
          </button>
        </div>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 dark:bg-slate-950/90"
      style={{ backdropFilter: 'blur(16px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-slate-800/80 dark:bg-slate-900"
        style={{
          width: 'min(96vw, 1400px)',
          maxHeight: '88vh',
        }}
      >
        {/* Modal header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="h-1 w-4 rounded-full bg-sky-500" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400 dark:text-slate-600">Fullscreen</div>
              <div className="text-base font-bold text-gray-900 dark:text-slate-100">{SECTION_LABELS[section]}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
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
            <span className="font-semibold text-gray-800 dark:text-slate-200">{item.keyword}</span>
            <span className="tabular-nums text-gray-500 dark:text-slate-500">{item.frequency} papers · {item.percentage.toFixed(2)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-800">
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
        <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-slate-800/60 dark:bg-slate-950/50">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400 dark:text-slate-600">{label}</div>
          <div className="mt-1.5 break-all text-sm font-medium text-gray-800 dark:text-slate-200">{val}</div>
        </div>
      ))}
    </div>
  )
}

function FullscreenWordCloud({
  items,
  theme,
  downloadName,
}: {
  items: WordCloudWord[]
  theme: ThemeMode
  downloadName: string
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  return (
    <div className="relative min-h-[60vh] overflow-hidden rounded-2xl border border-gray-200 dark:border-slate-800/50">
      <button
        type="button"
        onClick={() => svgToPng(svgRef.current, downloadName, () => toast.error('Could not export the word cloud image'))}
        className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-700/60 bg-white/90 dark:bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-300 backdrop-blur transition hover:bg-white dark:hover:bg-slate-800"
      >
        <ArrowDownTrayIcon className="h-3.5 w-3.5" />
        Download PNG
      </button>
      <WordCloudSvg items={items} theme={theme} svgRef={svgRef} className="h-[70vh] w-full" interactive />
    </div>
  )
}

function FullscreenCentrality({ rows }: { rows: CentralityScore[] }) {
  return (
    <div className="overflow-auto rounded-2xl border border-gray-200 dark:border-slate-800/50">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-gray-50 dark:bg-[#0a1628]">
          <tr className="border-b border-gray-200 dark:border-slate-800">
            {['#', 'Keyword', 'Degree', 'Closeness', 'Betweenness', 'Eigenvector', 'Clustering'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 dark:text-slate-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.keyword} className="border-b border-gray-100 hover:bg-gray-50 dark:border-slate-800/40 dark:hover:bg-slate-900/50">
              <td className="px-4 py-3">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold"
                  style={{ background: `${GRAPH_COLORS[i % GRAPH_COLORS.length]}20`, color: GRAPH_COLORS[i % GRAPH_COLORS.length] }}
                >
                  {i + 1}
                </span>
              </td>
              <td className="px-4 py-3 font-semibold text-gray-900 dark:text-slate-100">{row.keyword}</td>
              <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-slate-400">{row.degree_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-slate-400">{row.closeness_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-slate-400">{row.betweenness_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-slate-400">{row.eigenvector_centrality.toFixed(4)}</td>
              <td className="px-4 py-3 tabular-nums text-gray-500 dark:text-slate-400">{row.clustering_coefficient.toFixed(4)}</td>
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
    <div className="overflow-auto rounded-2xl border border-gray-200 dark:border-slate-800/50">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-gray-50 dark:bg-[#0a1628]">
          <tr className="border-b border-gray-200 dark:border-slate-800">
            <th className="sticky left-0 z-20 bg-gray-50 px-4 py-3 text-left font-bold uppercase tracking-[0.18em] text-gray-400 dark:bg-[#0a1628] dark:text-slate-600">Paper</th>
            <th className="px-4 py-3 text-left font-bold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-600">Source</th>
            <th className="px-4 py-3 text-left font-bold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-600">Year</th>
            {kwCols.map((kw) => (
              <th key={kw} className="px-2.5 py-3 text-center font-bold uppercase tracking-[0.14em] text-gray-400 dark:text-slate-600">
                <div className="w-14 truncate text-[10px]" title={kw}>{kw}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.paper_id} className="border-b border-gray-100 hover:bg-gray-50 dark:border-slate-800/40 dark:hover:bg-slate-900/40">
              <td className="sticky left-0 z-10 max-w-xs bg-white px-4 py-2.5 dark:bg-[#080f1e]">
                <div className="truncate font-semibold text-gray-800 dark:text-slate-200">{row.title}</div>
                <div className="truncate text-[10px] text-gray-400 dark:text-slate-600">{row.paper_id}</div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-gray-500 dark:text-slate-400">{row.source}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-gray-500 dark:text-slate-400">{row.year || '—'}</td>
              {kwCols.map((kw) => (
                <td key={kw} className="px-2.5 py-2.5 text-center">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                      row.values[kw] === 1
                        ? 'bg-sky-500 text-white dark:text-slate-950'
                        : 'bg-gray-100 text-gray-400 dark:bg-slate-800/60 dark:text-slate-600'
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
        <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-400 dark:border-slate-800 dark:text-slate-600">
          Showing {matrix.rows.length} of {matrix.total_rows} rows · {kwCols.length} of {matrix.total_columns} keywords
        </div>
      )}
    </div>
  )
}

function FullscreenNetwork({
  layout,
  theme,
  downloadName,
}: {
  layout: SphereLayout
  theme: ThemeMode
  downloadName: string
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-slate-800/50"
      style={{ minHeight: '70vh' }}
    >
      <button
        type="button"
        onClick={() => svgToPng(svgRef.current, downloadName, () => toast.error('Could not export the network image'))}
        className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-700/60 bg-white/90 dark:bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-300 backdrop-blur transition hover:bg-white dark:hover:bg-slate-800"
      >
        <ArrowDownTrayIcon className="h-3.5 w-3.5" />
        Download PNG
      </button>
      <NetworkGraph layout={layout} labelLimit={80} theme={theme} svgRef={svgRef} className="h-[70vh]" />
    </div>
  )
}

// ─── NetworkGraph (pseudo-3D rotatable sphere) ────────────────────────────────
function NetworkGraph({
  layout,
  labelLimit,
  theme,
  className,
  svgRef,
}: {
  layout: SphereLayout
  labelLimit: number
  theme: ThemeMode
  className?: string
  svgRef?: RefObject<SVGSVGElement | null>
}) {
  const { width, height, sphereRadius, nodes, edges } = layout
  const tokens = NETWORK_THEME[theme]
  const cx = width / 2
  const cy = height / 2

  // Keep a local ref and mirror it to the optional forwarded ref.
  const localSvgRef = useRef<SVGSVGElement | null>(null)
  const setSvg = (el: SVGSVGElement | null) => {
    localSvgRef.current = el
    if (svgRef) svgRef.current = el
  }

  // Rotation/drag state lives in refs — only a frame counter triggers re-render.
  const rotXRef = useRef(0)
  const rotYRef = useRef(0)
  const velRef = useRef({ x: 0, y: 0 })
  const draggingRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [, setFrame] = useState(0)

  const tick = useCallback(() => {
    if (!draggingRef.current) {
      // Inertia: let the sphere coast, then stop the loop when it settles.
      velRef.current.x *= 0.92
      velRef.current.y *= 0.92
      rotYRef.current += velRef.current.x
      rotXRef.current = clamp(rotXRef.current + velRef.current.y, -Math.PI / 2, Math.PI / 2)
      if (Math.abs(velRef.current.x) < 0.0004 && Math.abs(velRef.current.y) < 0.0004) {
        velRef.current = { x: 0, y: 0 }
        rafRef.current = null
        setFrame((f) => f + 1)
        return
      }
    }
    setFrame((f) => f + 1)
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const startRaf = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    draggingRef.current = true
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    velRef.current = { x: 0, y: 0 }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    startRaf()
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    const dx = e.clientX - lastPointerRef.current.x
    const dy = e.clientY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    rotYRef.current += dx * 0.006
    rotXRef.current = clamp(rotXRef.current - dy * 0.006, -Math.PI / 2, Math.PI / 2)
    velRef.current = { x: dx * 0.006, y: -dy * 0.006 }
  }

  const handlePointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    startRaf() // run inertia
  }

  // Wheel zoom — React's onWheel is passive, so attach a native non-passive
  // listener. preventDefault here also stops trackpad pinch (wheel + ctrlKey)
  // from zooming the whole browser.
  useEffect(() => {
    const svg = localSvgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.ctrlKey
        ? Math.exp(-e.deltaY * 0.01)
        : (e.deltaY < 0 ? 1.12 : 0.89)
      setZoom((z) => clamp(z * factor, 0.4, 4))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Cancel any running animation frame on unmount.
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  const resetView = () => {
    rotXRef.current = 0
    rotYRef.current = 0
    velRef.current = { x: 0, y: 0 }
    setZoom(1)
    setFrame((f) => f + 1)
  }

  // Per-frame: rotate + project every node, sort far→near so near nodes draw on top.
  const rendered = nodes
    .map((n) => {
      const r = rotatePoint(n.base, rotXRef.current, rotYRef.current)
      const p = projectPoint(r, cx, cy, sphereRadius, zoom)
      const depthT = (r[2] + 1) / 2 // 0 = back, 1 = front
      return {
        ...n,
        x: p.x,
        y: p.y,
        depth: r[2],
        drawRadius: Math.max(1.5, n.baseRadius * p.scale),
        opacity: 0.32 + 0.68 * depthT,
      }
    })
    .sort((a, b) => a.depth - b.depth)

  const posMap = new Map(rendered.map((n) => [n.keyword, n]))
  // Only label the front-most nodes (tail of the depth-sorted list).
  const labelSet = new Set(rendered.slice(-labelLimit).map((n) => n.keyword))

  return (
    <div
      className={`relative overflow-hidden ${className || ''}`}
      style={{ background: tokens.bg }}
    >
      <svg
        ref={setSvg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="Keyword co-occurrence network — drag to rotate, scroll to zoom"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <rect width={width} height={height} fill={tokens.bg} />

        {/* Edges */}
        {edges.map((edge, i) => {
          const s = posMap.get(edge.source)
          const t = posMap.get(edge.target)
          if (!s || !t) return null
          const depthFade = 0.55 + 0.45 * ((Math.min(s.depth, t.depth) + 1) / 2)
          return (
            <line
              key={`${edge.source}-${edge.target}-${i}`}
              x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke={tokens.edge}
              strokeWidth={edge.strokeWidth}
              strokeLinecap="round"
              opacity={edge.opacity * depthFade}
            />
          )
        })}

        {/* Nodes */}
        {rendered.map((node) => (
          <circle
            key={node.keyword}
            cx={node.x} cy={node.y} r={node.drawRadius}
            fill={node.color}
            stroke={tokens.nodeStroke}
            strokeWidth={1}
            opacity={node.opacity}
          />
        ))}

        {/* Labels — front-most nodes only */}
        {rendered
          .filter((n) => labelSet.has(n.keyword))
          .map((node) => (
            <text
              key={`label-${node.keyword}`}
              x={node.x}
              y={node.y + node.drawRadius + node.labelSize + 2}
              textAnchor="middle"
              fill={tokens.label}
              fontSize={node.labelSize}
              fontWeight={600}
              opacity={node.opacity}
              style={{ paintOrder: 'stroke', stroke: tokens.labelStroke, strokeWidth: 3 }}
            >
              {node.keyword}
            </text>
          ))}
      </svg>

      {/* Zoom / reset controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        {[
          { icon: MagnifyingGlassPlusIcon, fn: () => setZoom((z) => clamp(z * 1.2, 0.4, 4)), label: 'Zoom in' },
          { icon: MagnifyingGlassMinusIcon, fn: () => setZoom((z) => clamp(z * 0.83, 0.4, 4)), label: 'Zoom out' },
          { icon: ArrowPathIcon, fn: resetView, label: 'Reset view' },
        ].map(({ icon: Icon, fn, label }) => (
          <button
            key={label}
            type="button"
            onClick={fn}
            title={label}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/80 text-gray-600 dark:text-slate-300 backdrop-blur transition hover:bg-white dark:hover:bg-slate-800"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
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

// ─── Pseudo-3D sphere network layout ──────────────────────────────────────────
type Vec3 = [number, number, number]

interface SphereNode {
  keyword: string
  base: Vec3        // position on the unit sphere (before rotation)
  baseRadius: number
  color: string
  labelSize: number
  score: number
}

interface SphereEdge {
  source: string
  target: string
  weight: number
  strokeWidth: number
  opacity: number
}

interface SphereLayout {
  width: number
  height: number
  sphereRadius: number
  nodes: SphereNode[]
  edges: SphereEdge[]
}

// Distribute n points evenly over a unit sphere (golden-angle spiral).
function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = []
  if (n <= 0) return pts
  const phi = Math.PI * (3 - Math.sqrt(5)) // golden angle
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const t = phi * i
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r])
  }
  return pts
}

// Rotate a point around the Y axis then the X axis.
function rotatePoint([x, y, z]: Vec3, rx: number, ry: number): Vec3 {
  const cyA = Math.cos(ry), syA = Math.sin(ry)
  const x1 = x * cyA + z * syA
  const z1 = -x * syA + z * cyA
  const cxA = Math.cos(rx), sxA = Math.sin(rx)
  const y1 = y * cxA - z1 * sxA
  const z2 = y * sxA + z1 * cxA
  return [x1, y1, z2]
}

// Project a rotated point to 2D with a light perspective effect.
function projectPoint([x, y, z]: Vec3, cx: number, cy: number, radius: number, zoom: number) {
  const persp = 2.6
  const f = persp / (persp - z)
  return {
    x: cx + x * radius * f * zoom,
    y: cy + y * radius * f * zoom,
    scale: f * zoom,
  }
}

function buildSphereLayout(
  keywords: KeywordFrequencyItem[],
  edges: CoOccurrenceEdge[],
  centralityScores: CentralityScore[],
  fullscreen: boolean,
): SphereLayout {
  const width = fullscreen ? 1200 : 900
  const height = fullscreen ? 800 : 600
  const sphereRadius = Math.min(width, height) * 0.34

  const centralityMap = new Map(centralityScores.map((r) => [r.keyword, r]))
  const sorted = [...keywords].sort((a, b) => {
    const ac = centralityMap.get(a.keyword)?.degree_centrality || 0
    const bc = centralityMap.get(b.keyword)?.degree_centrality || 0
    return bc - ac || b.frequency - a.frequency
  })

  const sphere = fibonacciSphere(sorted.length)
  const maxFreq = Math.max(sorted[0]?.frequency || 1, 1)
  const nodes: SphereNode[] = sorted.map((item, idx) => ({
    keyword: item.keyword,
    base: sphere[idx] ?? [0, 0, 0],
    baseRadius: clamp(3 + (item.frequency / maxFreq) * (fullscreen ? 13 : 10), 3, fullscreen ? 18 : 14),
    color: GRAPH_COLORS[idx % GRAPH_COLORS.length],
    labelSize: fullscreen ? 12 : 10,
    score: item.frequency,
  }))

  const keywordSet = new Set(nodes.map((n) => n.keyword))
  const maxW = Math.max(...edges.map((e) => e.weight), 1)
  const sphereEdges: SphereEdge[] = edges
    .filter((e) => keywordSet.has(e.source) && keywordSet.has(e.target))
    .slice(0, fullscreen ? 220 : 140)
    .map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      strokeWidth: clamp(0.7 + (e.weight / maxW) * 3, 0.7, fullscreen ? 4 : 3),
      opacity: clamp(0.35 + (e.weight / maxW) * 0.55, 0.35, 0.9),
    }))

  return { width, height, sphereRadius, nodes, edges: sphereEdges }
}

// ─── Word cloud layout + SVG renderer ─────────────────────────────────────────
interface PlacedWord extends WordCloudWord {
  x: number
  y: number
}

const WORDCLOUD_VIEW = { w: 960, h: 540 }

// Dense "Wordle"-style packing: measure each word, then walk an Archimedean
// spiral outward from the centre until it no longer overlaps a placed word.
function layoutWordCloud(items: WordCloudWord[], width: number, height: number): PlacedWord[] {
  if (!items.length) return []
  const cx = width / 2
  const cy = height / 2
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const result: PlacedWord[] = []

  let ctx: CanvasRenderingContext2D | null = null
  if (typeof document !== 'undefined') {
    ctx = document.createElement('canvas').getContext('2d')
  }

  for (const word of items) {
    let textW: number
    if (ctx) {
      ctx.font = `700 ${word.size}px Inter, sans-serif`
      textW = ctx.measureText(word.keyword).width
    } else {
      textW = word.keyword.length * word.size * 0.55
    }
    const textH = word.size * 1.02
    const padX = word.size * 0.22
    const padY = word.size * 0.16
    let boxW = textW + padX * 2
    let boxH = textH + padY * 2
    if (word.rotate === 90) { const tmp = boxW; boxW = boxH; boxH = tmp }

    // Spiral search — the first word lands dead centre (no collisions yet).
    let px = cx
    let py = cy
    for (let t = 0; t < 4000; t += 0.18) {
      const r = 3.1 * t
      px = cx + r * Math.cos(t) * 1.35 // slight horizontal stretch → ellipse
      py = cy + r * Math.sin(t)
      let collide = false
      for (const b of placed) {
        if (
          Math.abs(px - b.x) < (boxW + b.w) / 2 + 2 &&
          Math.abs(py - b.y) < (boxH + b.h) / 2 + 2
        ) { collide = true; break }
      }
      if (!collide) break
    }
    placed.push({ x: px, y: py, w: boxW, h: boxH })
    result.push({ ...word, x: px, y: py })
  }
  return result
}

function WordCloudSvg({
  items,
  theme,
  svgRef,
  className,
  interactive = false,
}: {
  items: WordCloudWord[]
  theme: ThemeMode
  svgRef?: RefObject<SVGSVGElement | null>
  className?: string
  interactive?: boolean
}) {
  const { w, h } = WORDCLOUD_VIEW
  const placed = useMemo(() => layoutWordCloud(items, w, h), [items, w, h])
  const palette = WORDCLOUD_COLORS[theme]

  // Compute the exact bounding box of every placed word so the SVG viewBox
  // expands to fit them all — the spiral layout often extends past the design
  // canvas when many words are packed, which previously caused clipping.
  const viewBox = useMemo(() => {
    if (!placed.length) return { x: 0, y: 0, w, h }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const word of placed) {
      const textW = word.keyword.length * word.size * 0.55
      const textH = word.size * 1.02
      let halfW = textW / 2 + word.size * 0.22
      let halfH = textH / 2 + word.size * 0.16
      if (word.rotate === 90) { const t = halfW; halfW = halfH; halfH = t }
      minX = Math.min(minX, word.x - halfW)
      minY = Math.min(minY, word.y - halfH)
      maxX = Math.max(maxX, word.x + halfW)
      maxY = Math.max(maxY, word.y + halfH)
    }
    const pad = 28
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 }
  }, [placed, w, h])

  // Zoom + pan (interactive mode only)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const zoomBy = (k: number) => setZoom((z) => Math.min(8, Math.max(0.3, z * k)))

  // React's onWheel is passive — preventDefault() is silently ignored, so page
  // scroll bleeds through and trackpad pinch (wheel + ctrlKey) zooms the whole
  // browser. Attach a native non-passive listener instead.
  useEffect(() => {
    if (!interactive) return
    const el = containerRef.current
    if (!el) return
    const handle = (e: WheelEvent) => {
      e.preventDefault()
      // Trackpad pinch comes through as wheel events with ctrlKey=true and
      // very small deltaY values — same code path, just a finer factor.
      const factor = e.ctrlKey
        ? Math.exp(-e.deltaY * 0.01)
        : (e.deltaY < 0 ? 1.12 : 1 / 1.12)
      setZoom((z) => Math.min(8, Math.max(0.3, z * factor)))
    }
    el.addEventListener('wheel', handle, { passive: false })
    return () => el.removeEventListener('wheel', handle)
  }, [interactive])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    setDragging(true)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || !dragRef.current) return
    setPan({
      x: dragRef.current.px + (e.clientX - dragRef.current.x),
      y: dragRef.current.py + (e.clientY - dragRef.current.y),
    })
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    dragRef.current = null
    setDragging(false)
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className || ''} ${
        interactive ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
      } select-none touch-none overscroll-contain`}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
    >
      <div
        className="h-full w-full"
        style={{
          transform: interactive
            ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`
            : undefined,
          transformOrigin: 'center center',
          transition: dragging ? 'none' : 'transform 0.18s ease-out',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full"
          role="img"
          aria-label="Keyword word cloud"
        >
          <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill={WORDCLOUD_BG[theme]} />
          {placed.map((word) => (
            <text
              key={word.keyword}
              x={word.x}
              y={word.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Inter, sans-serif"
              fontWeight={700}
              fontSize={word.size}
              fill={palette[word.colorIndex % palette.length]}
              transform={word.rotate === 90 ? `rotate(90 ${word.x} ${word.y})` : undefined}
            >
              {word.keyword}
            </text>
          ))}
        </svg>
      </div>

      {interactive && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-gray-200 bg-white/90 px-1 py-1 shadow-md backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/85">
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            title="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <MagnifyingGlassPlusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            title="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <MagnifyingGlassMinusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={reset}
            title="Reset zoom"
            className="flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Reset
          </button>
          <span className="ml-1 hidden text-[10px] font-medium tabular-nums text-gray-400 dark:text-slate-500 sm:inline">
            {Math.round(zoom * 100)}%
          </span>
        </div>
      )}
    </div>
  )
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}