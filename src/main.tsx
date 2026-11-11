import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { WorkspacePreferencesProvider } from './context/WorkspacePreferences'
import './index.css'
import AppWithDashboards from './AppWithDashboards.tsx'
import { DashboardShellProvider } from './context/DashboardShellContext.tsx'
import { OperationsFeedProvider } from './context/OperationsFeedContext.tsx'
import { SelectionProvider } from './context/SelectionContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspacePreferencesProvider>
    <DashboardShellProvider>
      <OperationsFeedProvider>
        <SelectionProvider>
          <AppWithDashboards />
        </SelectionProvider>
      </OperationsFeedProvider>
      <Toaster
        theme="dark"
        position="bottom-right"
        richColors
        closeButton
        visibleToasts={3}
        duration={4000}
        toastOptions={{
          style: {
            background: 'var(--bg-1)',
            borderColor: 'var(--line)',
            color: 'var(--text-1)',
            fontSize: '13px',
          },
        }}
      />
    </DashboardShellProvider>
    </WorkspacePreferencesProvider>
  </StrictMode>,
)
