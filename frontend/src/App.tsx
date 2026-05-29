import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/components/theme-provider'
import { SearchProvider } from '@/context/SearchContext'
import { EmbeddingProvider } from '@/context/EmbeddingContext'
import { ChatProvider } from '@/context/ChatContext'
import { AnalyticsProvider } from '@/context/AnalyticsContext'
import { Layout } from '@/components/layout/Layout'
import { HomePage } from '@/pages/HomePage'
import { SearchPage } from '@/pages/SearchPage'
import { ChatPage } from '@/pages/ChatPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="research-rover-theme">
      <SearchProvider>
        <EmbeddingProvider>
          <ChatProvider>
            <AnalyticsProvider>
              <Layout>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </Layout>
            </AnalyticsProvider>
          </ChatProvider>
        </EmbeddingProvider>
      </SearchProvider>
    </ThemeProvider>
  )
}

export default App