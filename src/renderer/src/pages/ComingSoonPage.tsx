import type { ReactNode } from 'react'
import { IconHourglass } from '@tabler/icons-react'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'

/** A section of the spec that a later stage of the plan fills in. */
export function ComingSoonPage({ title, description }: { title: string; description: ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={IconHourglass} title="Раздел в разработке" description={description} />
    </>
  )
}
