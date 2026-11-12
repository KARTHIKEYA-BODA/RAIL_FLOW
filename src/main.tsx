import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import { ControllerWorkspace } from './components/operations/ControllerWorkspace.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <ControllerWorkspace />
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
  </StrictMode>,
)
