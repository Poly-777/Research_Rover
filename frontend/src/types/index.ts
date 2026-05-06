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
}

export interface SearchFilters {
  startDate?: string
  endDate?: string
  source: 'core' | 'pubmed'
  maxResults?: number
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
