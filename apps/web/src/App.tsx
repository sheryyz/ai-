import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import type { CSSProperties } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { Shell } from './components/Shell'
import { ApiError } from './lib/api'
import { HubPage } from './pages/HubPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RuntimePage } from './pages/RuntimePage'
import { SharePage } from './pages/SharePage'
import { StudioPage } from './pages/StudioPage'

// Sonner ships its own light palette; point it at the design tokens so toasts follow the theme.
const toastTokens = {
  '--normal-bg': 'var(--surface)',
  '--normal-border': 'var(--border)',
  '--normal-text': 'var(--text)',
} as CSSProperties

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // Client errors (404, validation) will not fix themselves; only retry network / server failures.
      retry: (count, e) => count < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
    },
  },
})

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <HubPage /> },
      { path: '/apps/:id', element: <RuntimePage /> },
      { path: '/apps/:id/studio', element: <StudioPage /> },
      { path: '/studio/new', element: <StudioPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // Share pages stand alone: no platform header, AI status or links back into the admin side.
  { path: '/v/:token', element: <SharePage /> },
])

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
        <Toaster
          position="bottom-right"
          style={toastTokens}
          toastOptions={{ className: 'font-sans text-sm' }}
        />
      </MotionConfig>
    </QueryClientProvider>
  )
}
