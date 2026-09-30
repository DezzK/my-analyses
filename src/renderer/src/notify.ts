import { notifications } from '@mantine/notifications'
import { errorMessage } from './api'

/** Tells the person that a call failed, in words meant for them. */
export function notifyError(error: unknown): void {
  notifications.show({ color: 'red', message: errorMessage(error) })
}
