import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  MagnifyingGlassIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  CloudArrowDownIcon,
  CpuChipIcon,
  SparklesIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline'
import { useState, useEffect } from 'react'
import { healthApi } from '@/services/api'

const features = [
  {
    name: 'Advanced Search',
    description: 'Search through millions of research papers with intelligent filtering and real-time results.',
    icon: MagnifyingGlassIcon,
    href: '/search',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    name: 'AI-Powered Chat',
    description: 'Ask questions about your research papers and get intelligent, contextual answers.',
    icon: ChatBubbleLeftRightIcon,
    href: '/chat',
    color: 'from-purple-500 to-pink-500',
  },
]

const quickActions = [
  {
    name: 'Recent Papers',
    description: 'View your recently accessed papers',
    icon: DocumentTextIcon,
    action: () => console.log('Recent papers'),
  },
  {
    name: 'Download Manager',
    description: 'Manage your paper downloads',
    icon: CloudArrowDownIcon,
    action: () => console.log('Downloads'),
  },
  {
    name: 'Vector Embeddings',
    description: 'Create embeddings for semantic search',
    icon: CpuChipIcon,
    action: () => window.location.href = '/search',
  },
]

// Removed fake stats - will be replaced with real data when available

export function HomePage() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        await healthApi.check()
        setApiStatus('online')
      } catch (error) {
        setApiStatus('offline')
      }
    }
    checkApiHealth()
  }, [])

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-12"
      >
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            <div className="flex flex-col items-center space-y-3 mb-6">
              <div className="inline-flex items-center px-4 py-2 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-700 dark:text-blue-300 text-sm font-medium">
                <SparklesIcon className="w-4 h-4 mr-2" />
                Powered by Advanced AI
              </div>
              <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${apiStatus === 'online'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                : apiStatus === 'offline'
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                  : 'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300'
                }`}>
                <div className={`w-2 h-2 rounded-full mr-2 ${apiStatus === 'online' ? 'bg-green-500' : apiStatus === 'offline' ? 'bg-red-500' : 'bg-gray-500'
                  }`} />
                API {apiStatus === 'checking' ? 'Checking...' : apiStatus === 'online' ? 'Online' : 'Offline'}
              </div>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold gradient-text mb-6">
              Research Rover
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
              Discover, analyze, and understand research papers with the power of AI.
              Your intelligent companion for academic research.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link to="/search">
              <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700">
                <RocketLaunchIcon className="w-5 h-5 mr-2" />
                Start Searching
              </Button>
            </Link>
            <Link to="/chat">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                <ChatBubbleLeftRightIcon className="w-5 h-5 mr-2" />
                Try AI Chat
              </Button>
            </Link>
          </motion.div>
        </div>
      </motion.section>

      {/* Quick Start Section */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Get Started
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            Choose how you want to explore research papers
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <Link to="/search">
            <Card className="hover-lift cursor-pointer group h-full">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center mb-4 mx-auto group-hover:scale-110 transition-transform">
                  <MagnifyingGlassIcon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Search Papers</h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Find research papers using PubMed search with advanced filtering
                </p>
              </CardContent>
            </Card>
          </Link>
          
          <Link to="/chat">
            <Card className="hover-lift cursor-pointer group h-full">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center mb-4 mx-auto group-hover:scale-110 transition-transform">
                  <ChatBubbleLeftRightIcon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-2">AI Chat</h3>
                <p className="text-gray-600 dark:text-gray-300">
                  Ask questions about your research papers and get intelligent answers
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </motion.section>

      {/* Features Section */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0 }}
      >
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Powerful Features
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Everything you need to streamline your research workflow and discover insights faster.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={feature.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 + index * 0.2 }}
            >
              <Link to={feature.href}>
                <Card className="h-full hover-lift cursor-pointer group">
                  <CardHeader>
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <feature.icon className="w-6 h-6 text-white" />
                    </div>
                    <CardTitle className="text-xl">{feature.name}</CardTitle>
                    <CardDescription className="text-base">
                      {feature.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Quick Actions */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.8 }}
      >
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Quick Actions
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {quickActions.map((action, index) => (
            <motion.div
              key={action.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 2.0 + index * 0.1 }}
            >
              <Card
                className="cursor-pointer hover-lift group"
                onClick={action.action}
              >
                <CardContent className="p-6 flex items-center space-x-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                    <action.icon className="w-5 h-5 text-gray-600 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      {action.name}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {action.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  )
}