import React, { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  PaperAirplaneIcon,
  UserIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ArrowUpTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline'
import type { ChatMessage } from '@/types'
import { filesApi } from '@/services/api'
import { useChat } from '@/context/ChatContext'
import { useEmbedding } from '@/context/EmbeddingContext'
import { EmbeddingProgressModal } from '@/components/EmbeddingProgressModal'

// ─── Fonts ────────────────────────────────────────────────────────────────────
const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href =
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap'
if (!document.head.querySelector('[href*="DM+Sans"]')) {
  document.head.appendChild(fontLink)
}

// ─── ChatPage ─────────────────────────────────────────────────────────────────
export function ChatPage() {
  const {
    messages,
    inputMessage,
    setInputMessage,
    isLoading,
    selectedFile,
    setSelectedFile,
    availableFiles,
    addAvailableFile,
    error,
    setError,
    hasEmbeddings,
    sendMessage,
  } = useChat()
  const { isCreating: isCreatingEmbeddings, startEmbeddings } = useEmbedding()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a .csv file')
      return
    }
    setError('')
    setUploading(true)
    try {
      const { filename } = await filesApi.upload(file)
      addAvailableFile(filename)
    } catch (err: any) {
      setError(err?.error || 'Failed to upload file')
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const inputDisabled = !selectedFile || isLoading || isCreatingEmbeddings
  const sendDisabled = !inputMessage.trim() || inputDisabled

  const inputPlaceholder = isCreatingEmbeddings
    ? 'Building embeddings, please wait…'
    : !selectedFile
    ? 'Select a collection to begin…'
    : !hasEmbeddings
    ? 'Ask away — create embeddings for richer answers…'
    : 'Ask about your research papers…'

  return (
    <div
      style={{ fontFamily: "'DM Sans', sans-serif" }}
      className="flex flex-col gap-5 pb-10 max-w-3xl mx-auto px-4 pt-8"
    >
      {/* ── Page Header ── */}
      <div>
        <p className="text-[11px] font-medium tracking-[0.1em] uppercase text-gray-400 dark:text-gray-500 mb-1">
          Research Assistant
        </p>
        <h1 className="text-[22px] font-medium text-gray-900 dark:text-gray-100">
          Ask your papers a question
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Contextual answers drawn directly from your uploaded research collections.
        </p>
      </div>

      {/* ── Collection Panel ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        {/* Section label */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <DocumentTextIcon className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-[11px] font-medium tracking-[0.1em] uppercase text-gray-400 dark:text-gray-500">
            Collection
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-5 py-4 flex-wrap">
          <select
            value={selectedFile || ''}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={isCreatingEmbeddings}
            className="flex-1 min-w-[180px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:opacity-50 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            <option value="">Choose a collection…</option>
            {availableFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || isCreatingEmbeddings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowUpTrayIcon className="w-3.5 h-3.5" />
            {uploading ? 'Uploading…' : 'Upload'}
          </button>

          {selectedFile && (
            <button
              onClick={() => startEmbeddings(selectedFile)}
              disabled={isCreatingEmbeddings || hasEmbeddings}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                hasEmbeddings
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700'
              }`}
            >
              <CpuChipIcon className="w-3.5 h-3.5" />
              {isCreatingEmbeddings
                ? 'Building…'
                : hasEmbeddings
                ? 'Embeddings ready'
                : 'Create embeddings'}
            </button>
          )}
        </div>

        {/* Status row */}
        {selectedFile && (
          <div className="flex items-center gap-2 px-5 pb-4 text-xs text-gray-500 dark:text-gray-400">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                hasEmbeddings ? 'bg-green-400' : 'bg-amber-400'
              } ${isCreatingEmbeddings ? 'animate-pulse' : ''}`}
            />
            {isCreatingEmbeddings
              ? `Creating embeddings for ${selectedFile}…`
              : hasEmbeddings
              ? `Embeddings active — ${selectedFile}`
              : `No embeddings found — create them to enable enhanced responses`}
          </div>
        )}
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          <span className="font-medium shrink-0">Error</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Chat Panel ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col">
        {/* Messages */}
        <div className="flex flex-col gap-4 p-5 min-h-[360px] max-h-[540px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-gray-400 dark:text-gray-600 text-center py-16">
              <DocumentTextIcon className="w-7 h-7 opacity-40" />
              <p className="text-sm">
                {selectedFile && hasEmbeddings
                  ? 'No messages yet — ask your first question.'
                  : 'Select a collection and create embeddings to begin.'}
              </p>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}

          {/* Thinking indicator */}
          {isLoading && (
            <div className="flex items-start gap-2.5">
              <Avatar type="ai" />
              <div className="flex items-center gap-1 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inputDisabled}
              placeholder={inputPlaceholder}
              style={{ fontFamily: "'DM Sans', sans-serif" }}
              className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3.5 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:opacity-40 transition-colors"
            />
            <button
              onClick={sendMessage}
              disabled={sendDisabled}
              className="w-8 h-8 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
            >
              <PaperAirplaneIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          {isCreatingEmbeddings && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              Chat will be available once embeddings finish building.
            </p>
          )}
        </div>
      </div>

      <EmbeddingProgressModal />
    </div>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ type }: { type: 'user' | 'ai' }) {
  return (
    <div
      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
        type === 'user'
          ? 'bg-blue-600 border-blue-600'
          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
      }`}
    >
      {type === 'user' ? (
        <UserIcon className="w-3.5 h-3.5 text-white" />
      ) : (
        <CpuChipIcon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
      )}
    </div>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────
interface MessageBubbleProps {
  message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const [sourcesOpen, setSourcesOpen] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <Avatar type={isUser ? 'user' : 'ai'} />

      <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Bubble */}
        <div
          className={`px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-blue-600 text-white'
              : 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-100 dark:border-gray-700'
          }`}
        >
          {message.content}
        </div>

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="w-full">
            <button
              onClick={() => setSourcesOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors mt-0.5"
            >
              <DocumentTextIcon className="w-3 h-3" />
              {message.sources.length} source{message.sources.length > 1 ? 's' : ''}
              {sourcesOpen ? (
                <ChevronUpIcon className="w-3 h-3" />
              ) : (
                <ChevronDownIcon className="w-3 h-3" />
              )}
            </button>

            {sourcesOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-2 mt-2"
              >
                {message.sources.map((source, index) => {
                  const url = source.url || (source.doi ? `https://doi.org/${source.doi}` : null)

                  return (
                    <div
                      key={source.id}
                      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3.5 py-3 flex flex-col gap-1"
                    >
                      {/* Source number */}
                      <span
                        className="text-[10px] font-medium tracking-[0.1em] uppercase text-gray-400"
                        style={{ fontFamily: "'DM Mono', monospace" }}
                      >
                        Source {index + 1}
                      </span>

                      {/* Title */}
                      {source.title && (
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
                          {source.title}
                        </p>
                      )}

                      {/* Preview */}
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                        {source.content_preview}
                      </p>

                      {/* Link */}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-0.5 w-fit"
                        >
                          <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                          View paper
                        </a>
                      )}
                    </div>
                  )
                })}
              </motion.div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <span
          className="text-[11px] text-gray-400 dark:text-gray-600"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </motion.div>
  )
}