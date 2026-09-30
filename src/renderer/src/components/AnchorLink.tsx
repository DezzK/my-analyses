import type { ComponentPropsWithRef } from 'react'
import { Anchor, type AnchorProps } from '@mantine/core'
import { createLink } from '@tanstack/react-router'

function AnchorBase(props: AnchorProps & ComponentPropsWithRef<'a'>) {
  return <Anchor component="a" {...props} />
}

/**
 * A Mantine text link to a route of the app. `component={Link}` on a Mantine component loses
 * the router's types, so links with route params go through this one.
 */
export const AnchorLink = createLink(AnchorBase)
