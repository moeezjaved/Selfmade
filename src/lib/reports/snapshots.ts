/**
 * Snapshot archive index — a per-org list of "Share once" snapshots, stored in R2 (no DB dependency,
 * same as the snapshot blobs themselves at shared-reports/<token>.json). Powers the /snapshots page.
 * Read is authoritative (getObjectText) so a freshly-created snapshot shows up immediately.
 */
import { uploadBufferToR2, getObjectText, deleteFromR2 } from '@/lib/r2'

export type SnapshotEntry = {
  token: string; name: string; emoji: string; templateKey: string
  note: string; createdAt: string; sharedBy: string; mode: 'once' | 'partner'
}

const indexKey = (org: string) => `snapshots-index/${org}.json`

async function readIndex(org: string): Promise<SnapshotEntry[]> {
  const txt = await getObjectText(indexKey(org))
  if (!txt) return []
  try { const j = JSON.parse(txt); return Array.isArray(j) ? j : [] } catch { return [] }
}
async function writeIndex(org: string, list: SnapshotEntry[]): Promise<boolean> {
  const url = await uploadBufferToR2(Buffer.from(JSON.stringify(list)), indexKey(org), 'application/json')
  return !!url
}

/** Append a newly-created snapshot to the org's archive (newest first, capped). */
export async function recordSnapshot(org: string, e: SnapshotEntry): Promise<void> {
  const list = await readIndex(org)
  list.unshift(e)
  await writeIndex(org, list.slice(0, 500))
}

/** List an org's snapshots, newest first. */
export async function listSnapshots(org: string): Promise<SnapshotEntry[]> {
  return readIndex(org)
}

/** Remove a snapshot from the archive and delete its frozen blob (best-effort). */
export async function removeSnapshot(org: string, token: string): Promise<void> {
  const list = await readIndex(org)
  await writeIndex(org, list.filter(x => x.token !== token))
  try { await deleteFromR2(`shared-reports/${token}.json`) } catch { /* best-effort */ }
}
