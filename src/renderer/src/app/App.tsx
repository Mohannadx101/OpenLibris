import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LibraryPage } from '@renderer/features/library/LibraryPage'
import { ReaderPage } from '@renderer/features/reader/ReaderPage'

// A hash router works with the file:// URL the packaged app loads from.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/read/:bookId" element={<ReaderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
