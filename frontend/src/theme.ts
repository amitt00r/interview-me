import { createTheme } from '@mantine/core';

/**
 * App-wide Mantine theme. Components read colours and radius from here, so restyle the app in this file.
 * One corner radius everywhere (`md`, as on the room's timer panel): don't override it per component, and use
 * `var(--mantine-radius-md)` in styles.css. Only true circles (avatars, round icons, photos) are round.
 */
export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: { fontWeight: '700' },
  components: {
    Card: { defaultProps: { withBorder: true, padding: 'lg' } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
  },
});
