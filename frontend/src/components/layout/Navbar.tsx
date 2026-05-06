import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'
import { 
  MoonIcon, 
  SunIcon, 
  CogIcon,
  BellIcon,
  UserCircleIcon
} from '@heroicons/react/24/outline'
import { motion } from 'framer-motion'

export function Navbar() {
  const { theme, setTheme } = useTheme()
  const location = useLocation()

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700"
    >
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">RR</span>
            </div>
            <span className="text-xl font-bold gradient-text">
              Research Rover
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-8">
            <NavLink to="/" active={location.pathname === '/'}>
              Home
            </NavLink>
            <NavLink to="/search" active={location.pathname === '/search'}>
              Search
            </NavLink>
            <NavLink to="/analytics" active={location.pathname === '/analytics'}>
              Analysis
            </NavLink>
            <NavLink to="/chat" active={location.pathname === '/chat'}>
              AI Chat
            </NavLink>
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative">
              <BellIcon className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
            </Button>

            {/* Theme toggle */}
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === 'dark' ? (
                <SunIcon className="h-5 w-5" />
              ) : (
                <MoonIcon className="h-5 w-5" />
              )}
            </Button>

            {/* Settings */}
            <Link to="/settings">
              <Button variant="ghost" size="icon">
                <CogIcon className="h-5 w-5" />
              </Button>
            </Link>

            {/* User profile */}
            <Button variant="ghost" size="icon">
              <UserCircleIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.nav>
  )
}

interface NavLinkProps {
  to: string
  children: React.ReactNode
  active?: boolean
}

function NavLink({ to, children, active }: NavLinkProps) {
  return (
    <Link
      to={to}
      className={`relative px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400'
      }`}
    >
      {children}
      {active && (
        <motion.div
          layoutId="navbar-indicator"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"
        />
      )}
    </Link>
  )
}
