import type { ComponentPropsWithRef } from 'react'
import { Anchor, Button, type AnchorProps, type ButtonProps } from '@mantine/core'
import { createLink } from '@tanstack/react-router'

/*
 * Mantine components as links to routes of the app. `component={Link}` on a Mantine component
 * loses the router's types, so links with route params go through these.
 */

function AnchorBase(props: AnchorProps & ComponentPropsWithRef<'a'>) {
  return <Anchor component="a" {...props} />
}

function ButtonBase(props: ButtonProps & ComponentPropsWithRef<'a'>) {
  return <Button component="a" {...props} />
}

export const AnchorLink = createLink(AnchorBase)
export const ButtonLink = createLink(ButtonBase)
