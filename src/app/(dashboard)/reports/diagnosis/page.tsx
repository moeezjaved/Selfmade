'use client'
import MetaGate from '@/components/MetaGate'
import UpgradeGate from '@/components/UpgradeGate'
import MetaDiagnosis from '@/components/reports/MetaDiagnosis'

export const dynamic = 'force-dynamic'

// Gate order matches /reports: PLAN first (UpgradeGate), then connection (MetaGate). A Free user sees
// "upgrade", a Creator with no Meta sees "connect", everyone else sees the diagnosis.
export default function DiagnosisPageGate() {
  return (
    <UpgradeGate feature="campaigns" name="Account Diagnosis">
      <MetaGate feature="Account Diagnosis"><MetaDiagnosis /></MetaGate>
    </UpgradeGate>
  )
}
