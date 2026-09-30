import type { ComponentType, ReactNode } from 'react'
import { Stack, Text, ThemeIcon, Title } from '@mantine/core'

const ICON_SIZE = 28
const BADGE_SIZE = 56

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ size?: number }>
  title: string
  description: ReactNode
  children?: ReactNode
}) {
  return (
    <Stack align="center" gap="sm" py="3rem" maw={520} mx="auto" ta="center">
      <ThemeIcon size={BADGE_SIZE} radius="xl" variant="light">
        <Icon size={ICON_SIZE} />
      </ThemeIcon>
      <Title order={3}>{title}</Title>
      <Text c="dimmed">{description}</Text>
      {children}
    </Stack>
  )
}
