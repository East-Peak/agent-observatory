import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { selectDataSource } from '@/data/realDataSource'
import type { Snapshot } from '@/domain/types'
import '@/styles/observatory.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

// Build-time load of the ingested snapshot, isolated here at the production entry point. Vite
// statically analyzes this glob; a literal path matching no file (the snapshot is gitignored and
// absent until `npm run ingest`) yields an empty record, so a fresh clone still builds and falls
// back to the synthetic fixtures. When the file exists Vite inlines it — keeping the whole data
// seam synchronous (no fetch, no loading state). Tests/oracle/demo never go through here.
const ingested = import.meta.glob<Snapshot>('/data/snapshot.json', { eager: true, import: 'default' })

createRoot(rootElement).render(
  <StrictMode>
    <App dataSource={selectDataSource(ingested['/data/snapshot.json'])} />
  </StrictMode>,
)
