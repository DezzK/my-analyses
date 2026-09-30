import { createTheme } from '@mantine/core'

/** Weight of headings and of text that plays a heading's role (window and dialog titles). */
export const TITLE_WEIGHT = 650

const FONT_STACK = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 7, dark: 5 },
  fontFamily: FONT_STACK,
  headings: { fontFamily: FONT_STACK, fontWeight: String(TITLE_WEIGHT) },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Card: { defaultProps: { withBorder: true, radius: 'lg', padding: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true } },
  },
})
