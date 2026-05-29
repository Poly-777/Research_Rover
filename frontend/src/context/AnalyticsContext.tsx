import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Paper } from '@/types'
import type {
  AnalysisSourceInfo,
  AnalysisSummary,
  KeywordMatrixResponse,
} from '@/pages/AnalyticsPage'

interface AnalyticsContextValue {
  sources: AnalysisSourceInfo[]
  setSources: Dispatch<SetStateAction<AnalysisSourceInfo[]>>
  selectedFile: string
  setSelectedFile: Dispatch<SetStateAction<string>>
  summary: AnalysisSummary | null
  setSummary: Dispatch<SetStateAction<AnalysisSummary | null>>
  matrix: KeywordMatrixResponse | null
  setMatrix: Dispatch<SetStateAction<KeywordMatrixResponse | null>>
  previewRows: number
  setPreviewRows: Dispatch<SetStateAction<number>>
  generateOnSelect: boolean
  setGenerateOnSelect: Dispatch<SetStateAction<boolean>>
  topKeywordLimit: number
  setTopKeywordLimit: Dispatch<SetStateAction<number>>
  paperCache: Map<string, Paper[]>
  setPaperCache: Dispatch<SetStateAction<Map<string, Paper[]>>>
}

const AnalyticsContext = createContext<AnalyticsContextValue | undefined>(undefined)

/**
 * Holds the analytics page's data-bearing state above the router so the
 * selected file, computed summary/matrix, fetched-paper cache, and view
 * settings survive navigating to other pages. Transient UI state (loading
 * flags, errors, fullscreen, zoom/pan) stays local to the page.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<AnalysisSourceInfo[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [matrix, setMatrix] = useState<KeywordMatrixResponse | null>(null)
  const [previewRows, setPreviewRows] = useState(12)
  const [generateOnSelect, setGenerateOnSelect] = useState(true)
  const [topKeywordLimit, setTopKeywordLimit] = useState(100)
  const [paperCache, setPaperCache] = useState<Map<string, Paper[]>>(new Map())

  const value: AnalyticsContextValue = {
    sources, setSources,
    selectedFile, setSelectedFile,
    summary, setSummary,
    matrix, setMatrix,
    previewRows, setPreviewRows,
    generateOnSelect, setGenerateOnSelect,
    topKeywordLimit, setTopKeywordLimit,
    paperCache, setPaperCache,
  }

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>
}

export function useAnalytics() {
  const ctx = useContext(AnalyticsContext)
  if (!ctx) throw new Error('useAnalytics must be used within an AnalyticsProvider')
  return ctx
}
