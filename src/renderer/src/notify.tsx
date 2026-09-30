import { Button } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { errorMessage } from './api'

/** How long an action can be undone from the notification that reports it. */
const UNDO_WINDOW_MS = 10_000
let undoNotices = 0

/** Tells the person that a call failed, in words meant for them. */
export function notifyError(error: unknown): void {
  notifications.show({ color: 'red', message: errorMessage(error) })
}

/** Reports an action with a button that undoes it while the notification is shown. */
export function notifyUndoable(input: {
  title: string
  undoLabel: string
  undo: () => Promise<unknown>
}): void {
  undoNotices += 1
  const id = `undo-${undoNotices}`
  notifications.show({
    id,
    autoClose: UNDO_WINDOW_MS,
    title: input.title,
    message: (
      <Button
        size="xs"
        variant="light"
        mt={4}
        onClick={() => {
          input.undo().catch(notifyError)
          notifications.hide(id)
        }}
      >
        {input.undoLabel}
      </Button>
    ),
  })
}
