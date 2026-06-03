import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PaperAirplaneIcon,
  UserIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ArrowUpTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import type { ChatMessage } from '@/types'
import { filesApi } from '@/services/api'
import { useChat } from '@/context/ChatContext'
import { useEmbedding } from '@/context/EmbeddingContext'
import { useTheme } from '@/components/theme-provider'
import { EmbeddingProgressModal } from '@/components/EmbeddingProgressModal'

// ─── ChatPage ─────────────────────────────────────────────────────────────────
export function ChatPage() {
  const { theme } = useTheme()
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
  const {
    isCreating: isCreatingEmbeddings,
    startEmbeddings,
    scrapeFullText,
    setScrapeFullText,
  } = useEmbedding()
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
            Research assistant
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-slate-50 md:text-5xl">
            Chat with your papers
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-slate-400">
            Ask contextual questions across your selected research collection — answers grounded in the source papers you indexed.
          </p>
        </div>
      </motion.div>

      {/* ── Collection Panel ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="rounded-2xl border border-gray-200 dark:border-slate-800/60 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <div className="h-1 w-5 rounded-full bg-sky-500" />
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500 dark:text-slate-500">
              Collection
            </span>
          </div>

          {/* File row */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-500">
              <DocumentTextIcon className="h-3.5 w-3.5 text-sky-500/80 dark:text-sky-400/80" />
              Research CSV
            </label>
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="group relative min-w-[220px] flex-1">
                <select
                  value={selectedFile || ''}
                  onChange={(e) => setSelectedFile(e.target.value)}
                  disabled={isCreatingEmbeddings}
                  className="relative w-full appearance-none rounded-xl border border-gray-300 bg-gradient-to-b from-white to-gray-50/70 px-4 py-3 pr-12 text-sm font-medium text-gray-800 shadow-sm outline-none transition-all duration-200 hover:border-sky-400/70 hover:shadow-md hover:shadow-sky-500/5 focus:border-sky-500 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.18)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/80 dark:from-slate-900 dark:to-slate-900/40 dark:text-slate-100 dark:hover:border-sky-500/50"
                >
                  <option value="">Choose a collection…</option>
                  {availableFiles.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg bg-gray-100/80 text-gray-500 transition-colors duration-150 group-hover:bg-sky-500/10 group-hover:text-sky-600 dark:bg-slate-800/80 dark:text-slate-400 dark:group-hover:bg-sky-500/15 dark:group-hover:text-sky-300">
                  <ChevronDownIcon className="h-4 w-4" />
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isCreatingEmbeddings}
                title="Upload a CSV"
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 bg-gradient-to-b from-white to-gray-50/70 px-3.5 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:border-sky-400/70 hover:text-gray-900 hover:shadow-md hover:shadow-sky-500/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/80 dark:from-slate-900 dark:to-slate-900/40 dark:text-slate-300 dark:hover:border-sky-500/50 dark:hover:text-slate-100"
              >
                <ArrowUpTrayIcon className={`h-4 w-4 ${uploading ? 'animate-pulse' : ''}`} />
                <span className="hidden sm:inline">{uploading ? 'Uploading…' : 'Upload'}</span>
              </button>

              {selectedFile && (
                <button
                  type="button"
                  onClick={() => startEmbeddings(selectedFile, hasEmbeddings)}
                  disabled={isCreatingEmbeddings}
                  title={hasEmbeddings ? 'Rebuild this index with the current scraping setting' : 'Build the FAISS index for this collection'}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 px-3.5 py-3 text-sm font-semibold text-white shadow-md shadow-sky-500/25 transition hover:from-sky-400 hover:to-indigo-400 hover:shadow-lg hover:shadow-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CpuChipIcon className={`h-4 w-4 ${isCreatingEmbeddings ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">
                    {isCreatingEmbeddings ? 'Building…' : hasEmbeddings ? 'Recreate embeddings' : 'Create embeddings'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Toggles + status row */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-600 dark:text-slate-400">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={scrapeFullText}
                  onChange={(e) => setScrapeFullText(e.target.checked)}
                  disabled={isCreatingEmbeddings}
                  className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-gray-300 bg-white checked:border-sky-500 checked:bg-sky-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                />
                <svg
                  className="pointer-events-none absolute inset-0 hidden h-4 w-4 peer-checked:block"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path
                    d="M3 8l3.5 3.5L13 5"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              Scrape full text from paper URLs
              <span className="text-xs text-gray-400 dark:text-slate-600">
                {scrapeFullText ? '(richer, slower)' : '(abstracts only, fast)'}
              </span>
            </label>

            {selectedFile && (
              <span
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-xs ${
                  hasEmbeddings
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    hasEmbeddings ? 'bg-emerald-500' : 'bg-amber-500'
                  } ${isCreatingEmbeddings ? 'animate-pulse' : ''}`}
                />
                {isCreatingEmbeddings
                  ? `Creating embeddings for ${selectedFile}…`
                  : hasEmbeddings
                  ? `Embeddings active — ${selectedFile}`
                  : `No embeddings — create them for richer responses`}
              </span>
            )}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <XMarkIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400" />
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError('')}
                className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-200"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Chat Panel ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800/60 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4 dark:border-slate-800/60">
            <div className="h-1 w-5 rounded-full bg-sky-500" />
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500 dark:text-slate-500">
              Conversation
            </span>
          </div>

          {/* Messages */}
          <div className="flex max-h-[600px] min-h-[420px] flex-col gap-4 overflow-y-auto p-6">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-gray-400 dark:text-slate-600">
                <SparklesIcon className="h-8 w-8 opacity-50" />
                <p className="text-sm">
                  {selectedFile && hasEmbeddings
                    ? 'No messages yet — ask your first question.'
                    : 'Select a collection and create embeddings to begin.'}
                </p>
              </div>
            ) : (
              messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
            )}

            {isLoading && (
              <div className="flex items-start gap-3">
                <Avatar type="ai" />
                <div className="flex items-center gap-1 rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 dark:border-slate-800/60 dark:bg-slate-950/40">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1 w-1 animate-bounce rounded-full bg-sky-500/70"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 px-6 py-4 dark:border-slate-800/60">
            <div className="flex items-center gap-2.5">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={inputDisabled}
                placeholder={inputPlaceholder}
                className="flex-1 rounded-xl border border-gray-300 bg-gradient-to-b from-white to-gray-50/70 px-4 py-3 text-sm font-medium text-gray-800 placeholder:text-gray-400 shadow-sm outline-none transition-all duration-200 hover:border-sky-400/70 hover:shadow-md hover:shadow-sky-500/5 focus:border-sky-500 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.18)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/80 dark:from-slate-900 dark:to-slate-900/40 dark:text-slate-100 dark:placeholder:text-slate-600 dark:hover:border-sky-500/50"
              />
              <button
                onClick={sendMessage}
                disabled={sendDisabled}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-md shadow-sky-500/25 transition hover:from-sky-400 hover:to-indigo-400 hover:shadow-lg hover:shadow-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
              </button>
            </div>
            {isCreatingEmbeddings && (
              <p className="mt-2 text-xs text-sky-600 dark:text-sky-300">
                Chat will be available once embeddings finish building.
              </p>
            )}
          </div>
        </div>
      </motion.div>

      <EmbeddingProgressModal />
    </div>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ type }: { type: 'user' | 'ai' }) {
  if (type === 'user') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 shadow-md shadow-sky-500/20">
        <UserIcon className="h-4 w-4 text-white" />
      </div>
    )
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 dark:border-slate-700/80 dark:bg-slate-950/40">
      <CpuChipIcon className="h-4 w-4 text-sky-500 dark:text-sky-400" />
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
      className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <Avatar type={isUser ? 'user' : 'ai'} />

      <div className={`flex max-w-[78%] flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Bubble */}
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
            isUser
              ? 'bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-sky-500/20'
              : 'border border-gray-200 bg-gray-50 text-gray-900 dark:border-slate-800/60 dark:bg-slate-950/40 dark:text-slate-100'
          }`}
        >
          {message.content}
        </div>

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="w-full">
            <button
              onClick={() => setSourcesOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 transition-colors hover:text-sky-600 dark:text-slate-500 dark:hover:text-sky-300"
            >
              <DocumentTextIcon className="h-3 w-3" />
              {message.sources.length} source{message.sources.length > 1 ? 's' : ''}
              {sourcesOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
            </button>

            <AnimatePresence>
              {sourcesOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-2 flex flex-col gap-2 overflow-hidden"
                >
                  {message.sources.map((source, index) => {
                    const url = source.url || (source.doi ? `https://doi.org/${source.doi}` : null)
                    return (
                      <div
                        key={source.id}
                        className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-3 dark:border-slate-800/60 dark:bg-slate-950/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/15 text-[10px] font-bold text-sky-600 dark:text-sky-300">
                            {index + 1}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500">
                            Source
                          </span>
                        </div>

                        {source.title && (
                          <p className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900 dark:text-slate-100">
                            {source.title}
                          </p>
                        )}

                        <p className="line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-slate-400">
                          {source.content_preview}
                        </p>

                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-fit items-center gap-1 rounded-md bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/15 dark:text-sky-300"
                          >
                            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                            View paper
                          </a>
                        )}
                      </div>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[11px] tabular-nums text-gray-400 dark:text-slate-600">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </motion.div>
  )
}
