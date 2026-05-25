import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTheme } from '@/components/theme-provider'
import {
  CogIcon,
  MoonIcon,
  SunIcon,
  BellIcon,
  ShieldCheckIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline'

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [settings, setSettings] = useState({
    defaultSearchSource: 'core',
    defaultMaxResults: 10,
    autoSaveResults: true,
    enableAnalytics: true,
    notifications: {
      searchComplete: true,
      embeddingReady: true,
      systemUpdates: false,
    },
    apiSettings: {
      baseUrl: 'http://localhost:8000',
      timeout: 120000,
    },
  })

  const handleSave = () => {
    // Save settings logic here
    console.log('Saving settings:', settings)
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-4xl font-bold gradient-text mb-4">
          Settings
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-300">
          Customize your Research Rover experience
        </p>
      </motion.div>

      {/* Theme Settings */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CogIcon className="w-5 h-5 mr-2" />
              Appearance
            </CardTitle>
            <CardDescription>
              Customize the look and feel of the application
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-3 block">Theme</label>
              <div className="grid grid-cols-2 gap-3">
                <ThemeOption
                  theme="light"
                  currentTheme={theme}
                  onSelect={setTheme}
                  icon={SunIcon}
                  label="Light"
                />
                <ThemeOption
                  theme="dark"
                  currentTheme={theme}
                  onSelect={setTheme}
                  icon={MoonIcon}
                  label="Dark"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Search Settings */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CircleStackIcon className="w-5 h-5 mr-2" />
              Search Preferences
            </CardTitle>
            <CardDescription>
              Configure default search behavior
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Default Search Source
                </label>
                <select
                  value={settings.defaultSearchSource}
                  onChange={(e) => setSettings({
                    ...settings,
                    defaultSearchSource: e.target.value
                  })}
                  className="w-full p-2 border rounded-md bg-background"
                >
                  <option value="core">CORE</option>
                  <option value="pubmed">PubMed</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Default Max Results
                </label>
                <Input
                  type="number"
                  value={settings.defaultMaxResults}
                  onChange={(e) => setSettings({
                    ...settings,
                    defaultMaxResults: parseInt(e.target.value) || 10
                  })}
                  min="1"
                  max="1000"
                />
              </div>
            </div>
            
            <div className="space-y-4">
              <ToggleSetting
                label="Auto-save search results"
                description="Automatically save search results to CSV"
                checked={settings.autoSaveResults}
                onChange={(checked) => setSettings({
                  ...settings,
                  autoSaveResults: checked
                })}
              />
              <ToggleSetting
                label="Enable analytics tracking"
                description="Track search patterns for insights"
                checked={settings.enableAnalytics}
                onChange={(checked) => setSettings({
                  ...settings,
                  enableAnalytics: checked
                })}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Notifications */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BellIcon className="w-5 h-5 mr-2" />
              Notifications
            </CardTitle>
            <CardDescription>
              Choose what notifications you want to receive
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleSetting
              label="Search completion"
              description="Notify when search operations complete"
              checked={settings.notifications.searchComplete}
              onChange={(checked) => setSettings({
                ...settings,
                notifications: {
                  ...settings.notifications,
                  searchComplete: checked
                }
              })}
            />
            <ToggleSetting
              label="Embedding ready"
              description="Notify when vector embeddings are created"
              checked={settings.notifications.embeddingReady}
              onChange={(checked) => setSettings({
                ...settings,
                notifications: {
                  ...settings.notifications,
                  embeddingReady: checked
                }
              })}
            />
            <ToggleSetting
              label="System updates"
              description="Notify about system updates and maintenance"
              checked={settings.notifications.systemUpdates}
              onChange={(checked) => setSettings({
                ...settings,
                notifications: {
                  ...settings.notifications,
                  systemUpdates: checked
                }
              })}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* API Settings */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <ShieldCheckIcon className="w-5 h-5 mr-2" />
              API Configuration
            </CardTitle>
            <CardDescription>
              Configure API endpoints and connection settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">
                API Base URL
              </label>
              <Input
                value={settings.apiSettings.baseUrl}
                onChange={(e) => setSettings({
                  ...settings,
                  apiSettings: {
                    ...settings.apiSettings,
                    baseUrl: e.target.value
                  }
                })}
                placeholder="http://localhost:8000"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">
                Request Timeout (ms)
              </label>
              <Input
                type="number"
                value={settings.apiSettings.timeout}
                onChange={(e) => setSettings({
                  ...settings,
                  apiSettings: {
                    ...settings.apiSettings,
                    timeout: parseInt(e.target.value) || 120000
                  }
                })}
                min="1000"
                max="120000"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Save Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0 }}
        className="flex justify-end"
      >
        <Button onClick={handleSave} size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700">
          Save Settings
        </Button>
      </motion.div>
    </div>
  )
}

interface ThemeOptionProps {
  theme: 'light' | 'dark'
  currentTheme: string
  onSelect: (theme: 'light' | 'dark') => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}

function ThemeOption({ theme, currentTheme, onSelect, icon: Icon, label }: ThemeOptionProps) {
  const isSelected = currentTheme === theme

  return (
    <button
      onClick={() => onSelect(theme)}
      className={`p-4 rounded-lg border-2 transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <Icon className={`w-6 h-6 mx-auto mb-2 ${
        isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'
      }`} />
      <div className={`text-sm font-medium ${
        isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'
      }`}>
        {label}
      </div>
    </button>
  )
}

interface ToggleSettingProps {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleSetting({ label, description, checked, onChange }: ToggleSettingProps) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <div>
        <div className="font-medium text-gray-900 dark:text-gray-100">
          {label}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {description}
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}