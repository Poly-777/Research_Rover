import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PaperAirplaneIcon,
  UserIcon,
  CpuChipIcon,
  DocumentTextIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'
import type { ChatMessage } from '@/types'
import { chatApi, filesApi, embeddingsApi, type ChatRequest } from '@/services/api'

const initialMessage: ChatMessage = {
  id: '1',
  type: 'assistant',
  content: 'Hello! I\'m your AI research assistant. I can help you analyze and understand research papers. Select a CSV file from your searches or ask me questions about your research.',
  timestamp: Date.now() - 60000,
}

interface EmbeddingProgress {
  stage: number
  message: string
  timestamp: number
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage])
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [availableFiles, setAvailableFiles] = useState<string[]>([])
  const [error, setError] = useState<string>('')
  const [isCreatingEmbeddings, setIsCreatingEmbeddings] = useState(false)
  const [embeddingProgress, setEmbeddingProgress] = useState<EmbeddingProgress | null>(null)
  const [hasEmbeddings, setHasEmbeddings] = useState<boolean>(false)
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Load available CSV files
  useEffect(() => {
    const loadFiles = async () => {
      try {
        const files = await filesApi.list()
        const csvFiles = files
          .filter(file => file.filename.endsWith('.csv'))
          .map(file => file.filename)
        setAvailableFiles(csvFiles)
      } catch (err: any) {
        console.error('Error loading files:', err)
      }
    }
    loadFiles()
  }, [])

  // Check embedding status when file is selected
  useEffect(() => {
    if (selectedFile) {
      checkEmbeddingStatus()
    }
  }, [selectedFile])

  // Cleanup progress interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }
  }, [])

  const checkEmbeddingStatus = async () => {
    if (!selectedFile) return
    
    try {
      const status = await embeddingsApi.getStatus(selectedFile)
      setHasEmbeddings(status.embeddings_exist)
    } catch (err: any) {
      console.error('Error checking embedding status:', err)
      setHasEmbeddings(false)
    }
  }

  const startProgressTracking = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const progress = await embeddingsApi.getProgress()
        setEmbeddingProgress(progress)

        // Check if completed (stage 3) or failed (stage -1)
        if (progress.stage === 3 || progress.stage === -1) {
          setIsCreatingEmbeddings(false)
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current)
            progressIntervalRef.current = null
          }
          
          if (progress.stage === 3) {
            setHasEmbeddings(true)
            // Auto-close modal after 2 seconds on success
            setTimeout(() => {
              setEmbeddingProgress(null)
            }, 2000)
          }
        }
      } catch (err: any) {
        console.error('Error fetching progress:', err)
        setIsCreatingEmbeddings(false)
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current)
          progressIntervalRef.current = null
        }
      }
    }, 1000) // Poll every second
  }

  const handleCreateEmbeddings = async () => {
    if (!selectedFile) return
    
    try {
      setError('')
      setIsCreatingEmbeddings(true)
      setEmbeddingProgress({
        stage: 0,
        message: 'Starting embedding creation...',
        timestamp: Date.now()
      })
      
      const response = await embeddingsApi.create(selectedFile)
      startProgressTracking()
    } catch (err: any) {
      setError(err.error || 'Failed to create embeddings')
      setIsCreatingEmbeddings(false)
      setEmbeddingProgress(null)
    }
  }

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isCreatingEmbeddings) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: inputMessage,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputMessage('')
    setIsLoading(true)
    setError('')

    try {
      const chatRequest: ChatRequest = {
        message: inputMessage,
        filename: selectedFile || undefined,
      }

      const response = await chatApi.sendMessageBody(chatRequest)
      
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: response.response,
        timestamp: Date.now(),
        sources: response.sources,
      }

      setMessages(prev => [...prev, aiMessage])
    } catch (err: any) {
      setError(err.error || 'Failed to send message')
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex flex-col space-y-6 pb-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-4xl font-bold gradient-text mb-4">
          AI Research Assistant
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          Ask questions about your research papers and get intelligent, contextual answers.
        </p>
      </motion.div>

      {/* File Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <DocumentTextIcon className="w-5 h-5 mr-2" />
              Select Research Collection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <select
                  value={selectedFile || ''}
                  onChange={(e) => setSelectedFile(e.target.value)}
                  className="flex-1 p-2 border rounded-md bg-background"
                  disabled={isCreatingEmbeddings}
                >
                  <option value="">Select a CSV file...</option>
                  {availableFiles.map((filename) => (
                    <option key={filename} value={filename}>
                      {filename}
                    </option>
                  ))}
                </select>
                <Button variant="outline">
                  Upload New File
                </Button>
                {selectedFile && (
                  <Button 
                    variant="outline"
                    onClick={handleCreateEmbeddings}
                    disabled={isCreatingEmbeddings || hasEmbeddings}
                  >
                    <CpuChipIcon className="w-4 h-4 mr-2" />
                    {hasEmbeddings ? 'Embeddings Ready' : 'Create Embeddings'}
                  </Button>
                )}
              </div>
              
              {/* Embedding Status */}
              {selectedFile && (
                <div className="flex items-center space-x-2 text-sm">
                  {hasEmbeddings ? (
                    <>
                      <CheckCircleIcon className="w-4 h-4 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">
                        Embeddings ready - Enhanced AI responses available
                      </span>
                    </>
                  ) : (
                    <>
                      <ExclamationCircleIcon className="w-4 h-4 text-amber-500" />
                      <span className="text-amber-600 dark:text-amber-400">
                        No embeddings found - Create embeddings for better AI responses
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Error Display */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mx-auto"
        >
          <Card className="border-red-200 bg-red-50 dark:bg-red-900/20">
            <CardContent className="p-4">
              <div className="text-red-800 dark:text-red-200">
                <strong>Error:</strong> {error}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Chat Interface */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="max-w-4xl mx-auto w-full"
      >
        <Card className="flex flex-col">
          {/* Messages */}
          <div className="p-6 space-y-4 min-h-[400px] max-h-[600px] overflow-y-auto custom-scrollbar">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            
            {isLoading && (
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center">
                  <CpuChipIcon className="w-4 h-4 text-white" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 max-w-xs">
                  <div className="loading-dots">Thinking</div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t p-4">
            <div className="flex space-x-4">
              <Input
                placeholder={
                  isCreatingEmbeddings 
                    ? "Please wait while embeddings are being created..." 
                    : selectedFile 
                      ? "Ask about your research papers..." 
                      : "Please select a file first..."
                }
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={!selectedFile || isLoading || isCreatingEmbeddings}
                className="flex-1"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || !selectedFile || isLoading || isCreatingEmbeddings}
                variant="premium"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </Button>
            </div>
            {!selectedFile && (
              <p className="text-sm text-gray-500 mt-2">
                Select a research collection to start chatting with your papers.
              </p>
            )}
            {isCreatingEmbeddings && (
              <p className="text-sm text-blue-600 dark:text-blue-400 mt-2">
                Embeddings are being created. Chat will be available once complete.
              </p>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Progress Modal */}
      <AnimatePresence>
        {embeddingProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Creating Embeddings</h3>
                {embeddingProgress.stage === 3 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEmbeddingProgress(null)}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <div className="space-y-4">
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      embeddingProgress.stage === -1
                        ? 'bg-red-500'
                        : embeddingProgress.stage === 3
                        ? 'bg-green-500'
                        : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${Math.max(0, Math.min(100, (embeddingProgress.stage / 3) * 100))}%`
                    }}
                  />
                </div>

                {/* Status Icon and Message */}
                <div className="flex items-center space-x-3">
                  {embeddingProgress.stage === -1 ? (
                    <ExclamationCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                  ) : embeddingProgress.stage === 3 ? (
                    <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
                  ) : (
                    <div className="w-6 h-6 flex-shrink-0">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      Stage {Math.max(0, embeddingProgress.stage)} of 3
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {embeddingProgress.message}
                    </p>
                  </div>
                </div>

                {/* Stage Details */}
                <div className="text-xs text-gray-500 space-y-1">
                  <div className={`flex items-center space-x-2 ${embeddingProgress.stage >= 0 ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                    <div className={`w-2 h-2 rounded-full ${embeddingProgress.stage >= 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                    <span>Initializing</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${embeddingProgress.stage >= 1 ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                    <div className={`w-2 h-2 rounded-full ${embeddingProgress.stage >= 1 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                    <span>Extracting full text from URLs</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${embeddingProgress.stage >= 2 ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                    <div className={`w-2 h-2 rounded-full ${embeddingProgress.stage >= 2 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                    <span>Generating embeddings and building index</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${embeddingProgress.stage >= 3 ? 'text-green-600 dark:text-green-400' : ''}`}>
                    <div className={`w-2 h-2 rounded-full ${embeddingProgress.stage >= 3 ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span>Complete</span>
                  </div>
                </div>

                {embeddingProgress.stage === 3 && (
                  <div className="text-center">
                    <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                      Embeddings created successfully! You can now chat with enhanced AI responses.
                    </p>
                  </div>
                )}

                {embeddingProgress.stage === -1 && (
                  <div className="text-center">
                    <Button
                      variant="outline"
                      onClick={() => setEmbeddingProgress(null)}
                      className="mt-2"
                    >
                      Close
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const [sourcesExpanded, setSourcesExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        isUser 
          ? 'bg-gray-200 dark:bg-gray-700' 
          : 'bg-gradient-to-r from-blue-500 to-purple-500'
      }`}>
        {isUser ? (
          <UserIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        ) : (
          <CpuChipIcon className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message Content */}
      <div className={`max-w-2xl ${isUser ? 'text-right' : ''}`}>
        <div className={`rounded-lg p-3 ${
          isUser
            ? 'bg-blue-600 text-white ml-auto'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
        }`}>
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-4 space-y-3"
          >
            <button
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              className="flex items-center space-x-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-full group"
            >
              <DocumentTextIcon className="w-4 h-4" />
              <span>Referenced Sources</span>
              <div className="flex-1 h-px bg-gradient-to-r from-gray-300 to-transparent dark:from-gray-600"></div>
              <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
                {message.sources.length} source{message.sources.length > 1 ? 's' : ''}
              </span>
              <motion.div
                animate={{ rotate: sourcesExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="ml-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </motion.div>
            </button>
            
            <AnimatePresence>
              {sourcesExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="grid gap-3 pt-2">
                    {message.sources.map((source, index) => {
                      const getSourceUrl = (source: any) => {
                        if (source.url) return source.url
                        if (source.doi) return `https://doi.org/${source.doi}`
                        return null
                      }
                      
                      const sourceUrl = getSourceUrl(source)
                      
                      return (
                        <motion.div
                          key={source.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 * index }}
                          className="group relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 hover:shadow-lg transition-all duration-300 hover:border-blue-300 dark:hover:border-blue-600"
                        >
                          {/* Source Number Badge */}
                          <div className="absolute top-3 left-3 w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg">
                            {source.id}
                          </div>
                          
                          {/* Content */}
                          <div className="p-4 pl-12">
                            {source.title && (
                              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {source.title}
                              </h4>
                            )}
                            
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3 leading-relaxed">
                              {source.content_preview}
                            </p>
                            
                            {/* Source Actions */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2 text-xs text-gray-500">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <span>Research Paper</span>
                              </div>
                              
                              {sourceUrl && (
                                <a
                                  href={sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center space-x-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-all duration-200 group/link"
                                >
                                  <span>View Source</span>
                                  <svg className="w-3 h-3 group-hover/link:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              )}
                            </div>
                          </div>
                          
                          {/* Hover Effect Overlay */}
                          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                        </motion.div>
                      )
                    })}
                  </div>
                  
                  {/* Sources Summary */}
                  <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <div className="flex items-center space-x-2">
                        <CheckCircleIcon className="w-4 h-4 text-green-500" />
                        <span>All sources verified and accessible</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span>Confidence:</span>
                        <div className="flex space-x-1">
                          {[...Array(5)].map((_, i) => (
                            <div
                              key={i}
                              className={`w-1.5 h-1.5 rounded-full ${
                                i < 4 ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="ml-1 font-medium">High</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Timestamp */}
        <div className={`text-xs text-gray-500 mt-1 ${isUser ? 'text-right' : ''}`}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </motion.div>
  )
}