import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { embeddingsApi, type EmbeddingProgress } from '@/services/api'

interface EmbeddingContextValue {
  isCreating: boolean
  progress: EmbeddingProgress | null
  /** Filename of the most recently completed job (so pages can refresh status). */
  completedFile: string | null
  startEmbeddings: (filename: string) => Promise<void>
  dismissProgress: () => void
}

const EmbeddingContext = createContext<EmbeddingContextValue | undefined>(undefined)

/**
 * Owns the single, app-wide embedding job. The backend tracks one job at a time,
 * so this provider sits above the router: any page can start a job and any page
 * can render its progress. Polling keeps running and resumes on mount, so the
 * progress modal survives navigation.
 */
export function EmbeddingProvider({ children }: { children: ReactNode }) {
  const [isCreating, setIsCreating] = useState(false)
  const [progress, setProgress] = useState<EmbeddingProgress | null>(null)
  const [completedFile, setCompletedFile] = useState<string | null>(null)
  const activeFileRef = useRef<string | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resume a running job on first mount (e.g. after a page reload).
  useEffect(() => {
    embeddingsApi
      .getProgress()
      .then((p) => {
        if (p.stage === 1 || p.stage === 2) {
          setProgress(p)
          setIsCreating(true)
        }
      })
      .catch(() => {})
  }, [])

  // Background polling — runs while a job is active, regardless of page.
  useEffect(() => {
    if (!isCreating) return
    const interval = setInterval(async () => {
      try {
        const p = await embeddingsApi.getProgress()
        setProgress(p)
        if (p.stage === 3 || p.stage === -1) {
          clearInterval(interval)
          setIsCreating(false)
          if (p.stage === 3) {
            setCompletedFile(activeFileRef.current)
            clearTimerRef.current = setTimeout(() => setProgress(null), 2000)
          }
        }
      } catch (err) {
        console.error('Error fetching embedding progress:', err)
        clearInterval(interval)
        setIsCreating(false)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [isCreating])

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
  }, [])

  const startEmbeddings = async (filename: string) => {
    if (!filename) return
    activeFileRef.current = filename
    setProgress({ stage: 0, message: 'Starting embedding creation...', timestamp: Date.now() })
    setIsCreating(true)
    try {
      await embeddingsApi.create(filename)
    } catch (err: any) {
      setIsCreating(false)
      setProgress({
        stage: -1,
        message: err?.error || 'Failed to create embeddings',
        timestamp: Date.now(),
      })
    }
  }

  const dismissProgress = () => setProgress(null)

  const value: EmbeddingContextValue = {
    isCreating,
    progress,
    completedFile,
    startEmbeddings,
    dismissProgress,
  }

  return <EmbeddingContext.Provider value={value}>{children}</EmbeddingContext.Provider>
}

export function useEmbedding() {
  const ctx = useContext(EmbeddingContext)
  if (!ctx) throw new Error('useEmbedding must be used within an EmbeddingProvider')
  return ctx
}
