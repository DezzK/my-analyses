import { useEffect, useRef } from 'react'
import { Button } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { UpdateStatus } from '@shared/api'
import { api } from './api'
import { formatDateTime } from './format'
import { notifyError } from './notify'
import { useUpdateStatus } from './queries'

/** The update's status in words; null when there is nothing to say. */
export function updateStatusText(status: UpdateStatus): string | null {
  switch (status.state) {
    case 'disabled':
      return 'Обновления приходят только в установленное приложение.'
    case 'current':
      return status.checkedAt
        ? `Установлена последняя версия, проверено ${formatDateTime(status.checkedAt)}.`
        : null
    case 'checking':
      return 'Проверяем обновления…'
    case 'downloading':
      return `Скачиваем версию ${status.version}: ${Math.round(status.share * 100)}%`
    case 'ready':
      return `Версия ${status.version} скачана и установится при выходе из приложения.`
    case 'failed':
      return status.message
  }
}

export function restartToUpdate(): void {
  api.updates.restart().catch(notifyError)
}

/** Says once per version that it has been downloaded, with a way to install it now. */
export function useUpdateReadyNotice(): void {
  const { data: status } = useUpdateStatus()
  const announced = useRef<string | null>(null)
  const version = status?.state === 'ready' ? status.version : null
  useEffect(() => {
    if (!version || announced.current === version) return
    announced.current = version
    notifications.show({
      autoClose: false,
      title: `Скачана версия ${version}`,
      message: (
        <>
          Она установится при выходе из приложения.{' '}
          <Button size="xs" variant="light" mt={4} onClick={restartToUpdate}>
            Перезапустить сейчас
          </Button>
        </>
      ),
    })
  }, [version])
}
