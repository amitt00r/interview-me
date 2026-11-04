import { Group, Paper, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { useEffect, useState } from 'react';
import { formatClock } from '../api';

/**
 * A ticking mm:ss display: `base` seconds plus time since `since` (epoch ms). `frozen` pins the shown value,
 * e.g. while an answer is being scored (shown dimmed). Ticks on its own so the parent doesn't re-render every
 * second. Meant to sit in a `Clocks` panel; `compact` is the smaller size for the whiteboard's short header.
 */
export function Clock({ label, icon, since, base = 0, frozen = null, title, compact = false }: {
  label: string;
  icon: React.ReactNode;
  since: number | null;
  base?: number;
  frozen?: number | null;
  title?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null || frozen !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since, frozen]);

  const live = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
  const clock = (
    <Group gap={compact ? 6 : 8} wrap="nowrap">
      <ThemeIcon variant="light" radius="xl" size={compact ? 'md' : 'lg'}>{icon}</ThemeIcon>
      <Stack gap={0}>
        <Text size="10px" tt="uppercase" fw={600} c="dimmed" lh={1.3} style={{ letterSpacing: 0.5 }}>{label}</Text>
        <Text fw={700} fz={compact ? 'md' : 'lg'} lh={1.1} className="tabular" c={frozen !== null ? 'dimmed' : undefined}>
          {formatClock(base + (frozen ?? live))}
        </Text>
      </Stack>
    </Group>
  );
  return title ? <Tooltip label={title}>{clock}</Tooltip> : clock;
}

/** Clocks side by side in one bordered panel, sharing its width equally, divided by thin rules. */
export function Clocks({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <Paper withBorder px={compact ? 'xs' : 'sm'} py={compact ? 4 : 6} className="clocks room-control">
      <Group gap={compact ? 'sm' : 'md'} wrap="nowrap" grow>{children}</Group>
    </Paper>
  );
}
