'use client'
/**
 * Advanced Page Builder — route wrapper (Phase 2). Isolated from the existing wizard/BuilderEditor: this
 * only exists at /builder/adv?pageId=… behind the sf_adv_editor flag, so the working builder is untouched
 * until the new editor reaches parity ([[project_advanced_page_builder]], risk note in the spec).
 */
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import AdvEditor from './AdvEditor'

function AdvEditorRoute() {
  const params = useSearchParams()
  const pageId = params.get('pageId') || ''
  if (!pageId) {
    return (
      <div style={{ padding: 40, fontFamily: 'Inter, system-ui, sans-serif', color: '#6e6a63' }}>
        Open a page from the builder to edit it here — this URL needs <code>?pageId=…</code>.
      </div>
    )
  }
  return <AdvEditor pageId={pageId} />
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: '#6e6a63' }}>Loading editor…</div>}>
      <AdvEditorRoute />
    </Suspense>
  )
}
