import { Group, Paper, Progress, Text } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import { ROOM_SILENCE, type SilenceTiming } from '../useSilenceSubmit';

/** "Sending in 4s": shown after a few seconds of silence while hands-free dictation is about to submit. */
export function SilenceCountdown({ remainingMs, action = 'Submitting', timing = ROOM_SILENCE, hint = 'Keep talking to continue' }: {
  remainingMs: number | null;
  action?: string;
  timing?: SilenceTiming;
  hint?: string;
}) {
  if (remainingMs === null) return null;
  const window = timing.submitMs - timing.warningMs;
  return (
    <Paper withBorder p="xs" className="silence-countdown" role="status" aria-live="polite">
      <Group justify="space-between" gap="xs" mb={6} wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <IconSend size={16} color="var(--mantine-primary-color-filled)" />
          <Text size="sm" fw={600}>{action} in {Math.ceil(remainingMs / 1000)}s</Text>
        </Group>
        <Text size="xs" c="dimmed">{hint}</Text>
      </Group>
      <Progress value={(remainingMs / window) * 100} size="sm" radius="xl" transitionDuration={200} />
    </Paper>
  );
}
