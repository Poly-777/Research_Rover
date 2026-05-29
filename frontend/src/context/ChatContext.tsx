import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import type { ChatMessage } from '@/types'
import { chatApi, filesApi, embeddingsApi, type ChatRequest } from '@/services/api'
import { useEmbedding } from '@/context/EmbeddingContext'

const initialMessage: ChatMessage = {
  id: '1',
  type: 'assistant',
  content:
    "Hello! I'm your AI research assistant. I can help you analyze and understand research papers. Select a CSV file from your searches or ask me questions about your research.",
  timestamp: Date.now() - 60000,
}

interface ChatContextValue {
  messages: ChatMessage[]
  inputMessage: string
  setInputMessage: (v: string) => void
  selectedFile: string | null
  setSelectedFile: (f: string | null) => void
  availableFiles: string[]
  /** Add a filename to the dropdown (if missing) and select it. */
  addAvailableFile: (filename: string) => void
  isLoading: boolean
  error: string
  setError: (e: string) => void
  hasEmbeddings: boolean
  sendMessage: () => Promise<void>
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined)

/**
 * Holds chat + embedding state above the router so the selected file, the
 * conversation, and an in-flight embedding job (and its progress modal) all
 * survive navigating to other pages. Progress polling runs in the background
 * independent of whether ChatPage is mounted.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { isCreating, completedFile } = useEmbedding()
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage])
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [availableFiles, setAvailableFiles] = useState<string[]>([])
  const [error, setError] = useState('')
  const [hasEmbeddings, setHasEmbeddings] = useState(false)

  // Load available CSV files once.
  useEffect(() => {
    filesApi
      .list()
      .then((files) => {
        setAvailableFiles(
          files.filter((f) => f.filename.endsWith('.csv')).map((f) => f.filename)
        )
      })
      .catch((err) => console.error('Error loading files:', err))
  }, [])

  // When an embedding job finishes (started here or on the Search page), surface
  // that file in Chat: add it to the dropdown if missing and auto-select it, so
  // the user can chat with it immediately without a page reload or manual pick.
  useEffect(() => {
    if (!completedFile) return
    setAvailableFiles((prev) =>
      prev.includes(completedFile) ? prev : [completedFile, ...prev]
    )
    setSelectedFile(completedFile)
  }, [completedFile])

  // Refresh embedding status when the selected file changes, or when an
  // embedding job finishes (completedFile flips), so the badge updates live.
  useEffect(() => {
    if (!selectedFile) return
    let cancelled = false
    embeddingsApi
      .getStatus(selectedFile)
      .then((status) => {
        if (!cancelled) setHasEmbeddings(status.embeddings_exist)
      })
      .catch(() => {
        if (!cancelled) setHasEmbeddings(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFile, completedFile])

  const addAvailableFile = (filename: string) => {
    setAvailableFiles((prev) =>
      prev.includes(filename) ? prev : [filename, ...prev]
    )
    setSelectedFile(filename)
  }

  const sendMessage = async () => {
    if (!inputMessage.trim() || isCreating) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: inputMessage,
      timestamp: Date.now(),
    }

    const messageText = inputMessage
    setMessages((prev) => [...prev, userMessage])
    setInputMessage('')
    setIsLoading(true)
    setError('')

    try {
      const chatRequest: ChatRequest = {
        message: messageText,
        filename: selectedFile || undefined,
      }
      const response = await chatApi.sendMessageBody(chatRequest)
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: response.response,
          timestamp: Date.now(),
          sources: response.sources,
        },
      ])
    } catch (err: any) {
      setError(err.error || 'Failed to send message')
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: 'Sorry, I encountered an error processing your message. Please try again.',
          timestamp: Date.now(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const value: ChatContextValue = {
    messages,
    inputMessage,
    setInputMessage,
    selectedFile,
    setSelectedFile,
    availableFiles,
    addAvailableFile,
    isLoading,
    error,
    setError,
    hasEmbeddings,
    sendMessage,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within a ChatProvider')
  return ctx
}
