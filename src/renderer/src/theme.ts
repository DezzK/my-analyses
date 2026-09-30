import { createTheme } from '@mantine/core'

/** Weight of headings and of text that plays a heading's role (window and dialog titles). */
export const TITLE_WEIGHT = 650

/** Icon sizes by where the icon sits: the window shell and the search field, buttons and menus, small buttons and hints. */
export const ICON_SIZE = { shell: 18, button: 16, small: 14 } as const

const FONT_STACK = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 7, dark: 5 },
  fontFamily: FONT_STACK,
  headings: { fontFamily: FONT_STACK, fontWeight: String(TITLE_WEIGHT) },
  defaultRadius: 'md',
  cursorType: 'pointer',
  // People who asked their system for less motion get dialogs and menus without animation.
  respectReducedMotion: true,
  components: {
    Card: { defaultProps: { withBorder: true, radius: 'lg', padding: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: {
      defaultProps: { radius: 'lg', centered: true },
      styles: { title: { fontWeight: TITLE_WEIGHT } },
    },
  },
})
