import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  HomeIcon,
  MagnifyingGlassIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  FolderIcon,
  CloudArrowDownIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline'

const sidebarItems = [
  {
    name: 'Home',
    href: '/',
    icon: HomeIcon,
  },
  {
    name: 'Search Papers',
    href: '/search',
    icon: MagnifyingGlassIcon,
  },
  {
    name: 'AI Chat',
    href: '/chat',
    icon: ChatBubbleLeftRightIcon,
  },
]

const quickActions = [
  {
    name: 'Recent Files',
    icon: DocumentTextIcon,
    action: () => console.log('Recent files'),
  },
  {
    name: 'File Manager',
    icon: FolderIcon,
    action: () => console.log('File manager'),
  },
  {
    name: 'Downloads',
    icon: CloudArrowDownIcon,
    action: () => console.log('Downloads'),
  },
  {
    name: 'Embeddings',
    icon: CpuChipIcon,
    action: () => console.log('Embeddings'),
  },
]

export function Sidebar() {
  const location = useLocation()

  return (
    <motion.aside
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border-r border-gray-200 dark:border-gray-700 overflow-y-auto custom-scrollbar"
    >
      <div className="p-6">
        {/* Navigation */}
        <nav className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Navigation
          </h3>
          {sidebarItems.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                <item.icon className="mr-3 h-5 w-5" />
                {item.name}
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="ml-auto w-1 h-6 bg-blue-600 dark:bg-blue-400 rounded-full"
                  />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Quick Actions */}
        <div className="mt-8">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Quick Actions
          </h3>
          <div className="space-y-2">
            {quickActions.map((action) => (
              <button
                key={action.name}
                onClick={action.action}
                className="flex items-center w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-gray-100 transition-all duration-200"
              >
                <action.icon className="mr-3 h-5 w-5" />
                {action.name}
              </button>
            ))}
          </div>
        </div>

        {/* Status Card */}
        <div className="mt-8 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
            System Status
          </h4>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-blue-700 dark:text-blue-300">API</span>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span className="text-green-600 dark:text-green-400">Online</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-700 dark:text-blue-300">Models</span>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span className="text-green-600 dark:text-green-400">Loaded</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.aside>
  )
}