import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { useEmbedding } from '@/context/EmbeddingContext'

/**
 * App-wide embedding progress modal. Renders whenever a job is active or just
 * finished, reading state from EmbeddingContext, so it can be dropped onto any
 * page (Chat, Search, ...) and reflect the same shared job.
 */
export function EmbeddingProgressModal() {
  const { progress, dismissProgress, cancelEmbeddings } = useEmbedding()
  const isActive = progress != null && progress.stage !== 3 && progress.stage !== -1

  return (
    <AnimatePresence>
      {progress && (
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
              {progress.stage === 3 && (
                <Button variant="ghost" size="sm" onClick={dismissProgress}>
                  <XMarkIcon className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="space-y-4">
              {/* Progress Bar */}
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    progress.stage === -1
                      ? 'bg-red-500'
                      : progress.stage === 3
                      ? 'bg-green-500'
                      : 'bg-blue-500'
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100,
                      progress.percent ?? (progress.stage / 3) * 100
                    ))}%`,
                  }}
                />
              </div>

              {/* Status Icon and Message */}
              <div className="flex items-center space-x-3">
                {progress.stage === -1 ? (
                  <ExclamationCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                ) : progress.stage === 3 ? (
                  <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
                ) : (
                  <div className="w-6 h-6 flex-shrink-0">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium">
                    Stage {Math.max(0, progress.stage)} of 3
                    {progress.percent != null && progress.stage > 0 && progress.stage < 3 && (
                      <span className="ml-2 text-blue-600 dark:text-blue-400">
                        {Math.round(progress.percent)}%
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{progress.message}</p>
                </div>
              </div>

              {/* Stage Details */}
              <div className="text-xs text-gray-500 space-y-1">
                <div className={`flex items-center space-x-2 ${progress.stage >= 0 ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                  <div className={`w-2 h-2 rounded-full ${progress.stage >= 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                  <span>Initializing</span>
                </div>
                <div className={`flex items-center space-x-2 ${progress.stage >= 1 ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                  <div className={`w-2 h-2 rounded-full ${progress.stage >= 1 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                  <span>Extracting full text from URLs</span>
                </div>
                <div className={`flex items-center space-x-2 ${progress.stage >= 2 ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                  <div className={`w-2 h-2 rounded-full ${progress.stage >= 2 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                  <span>Generating embeddings and building index</span>
                </div>
                <div className={`flex items-center space-x-2 ${progress.stage >= 3 ? 'text-green-600 dark:text-green-400' : ''}`}>
                  <div className={`w-2 h-2 rounded-full ${progress.stage >= 3 ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span>Complete</span>
                </div>
              </div>

              {progress.stage === 3 && (
                <div className="text-center">
                  <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                    Embeddings created successfully! You can now chat with enhanced AI responses.
                  </p>
                </div>
              )}

              {isActive && (
                <div className="text-center">
                  <Button variant="outline" onClick={cancelEmbeddings} className="mt-2">
                    Cancel
                  </Button>
                </div>
              )}

              {progress.stage === -1 && (
                <div className="text-center">
                  <Button variant="outline" onClick={dismissProgress} className="mt-2">
                    Close
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
