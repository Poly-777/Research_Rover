// Basic types for the application
export interface Paper {
  source: string
  title: string
  download_url?: string
  year?: string
  keywords: string[]
  doi?: string
  authors?: string[]
  abstract?: string
  relevance_score?: number | null
  relevance_rank?: number | null
}

export type SortMode = 'relevance' | 'recency'

export interface SearchFilters {
  startDate?: string
  endDate?: string
  source: 'core' | 'pubmed'
  maxResults?: number
  sortMode?: SortMode
}

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: number
  sources?: Array<{
    id: number
    type: string
    content_preview: string
    title?: string
    url?: string
    doi?: string
  }>
}

export type Theme = 'dark' | 'light' | 'system'

// ─── Metadata-driven analytics (backend AnalysisService) ─────────────────────
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
  summary_file?: string
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
  matrix_keywords: string[]
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

export interface AnalysisRequest {
  filename: string
  top_keywords?: number
  minimum_frequency?: number
  refresh?: boolean
}
