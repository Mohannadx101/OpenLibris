import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LibraryPage } from '@renderer/features/library/LibraryPage'

// A hash router works with the file:// URL the packaged app loads from.
// The reader route is added in Phase 2.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
