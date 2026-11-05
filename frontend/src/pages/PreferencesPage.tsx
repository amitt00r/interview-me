import { ActionIcon, Card, Group, Radio, SegmentedControl, Stack, Switch, Text, ThemeIcon, Title, Tooltip, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconCode, IconDeviceDesktop, IconMessageCircle, IconMoon, IconPalette, IconPlayerPlay, IconSun, IconVideo } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { NIKOLAI_VOICES, setNikolaiVoice, useNikolaiVoice } from '../nikolai';
import { CHAT_PAUSE, CODE_SUGGESTIONS, INTERVIEW_PAUSE, setFlag, setPref, useFlag, usePref } from '../preferences';
import { checkSpeech, speak, stopSpeaking } from '../speech';
import { useAsync } from '../useAsync';

const SAMPLE = 'Privet! This is how I sound. Khorosho?';

/**
 * App preferences, one card per area. All are per-browser (localStorage); add new settings as fields in the
 * relevant section, or a new section.
 */
export default function PreferencesPage() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const voice = useNikolaiVoice();
  const chatPause = usePref(CHAT_PAUSE);
  const interviewPause = usePref(INTERVIEW_PAUSE);
  const codeSuggestions = useFlag(CODE_SUGGESTIONS);
  const speech = useAsync(checkSpeech);

  const preview = (id: string) => {
    stopSpeaking();
    speak(SAMPLE, id).catch(() => { /* voice unavailable */ });
  };

  return (
    <Stack gap="lg" maw={760} mx="auto">
      <div>
        <Title order={2}>Preferences</Title>
        <Text c="dimmed">Saved in this browser.</Text>
      </div>

      <Section icon={<IconPalette size={18} />} title="Appearance">
        <Setting label="Theme" description="System follows your computer's light or dark mode.">
          <SegmentedControl value={colorScheme} onChange={(v) => setColorScheme(v as MantineColorScheme)}
            data={[
              { value: 'light', label: <Label icon={<IconSun size={14} />} text="Light" /> },
              { value: 'dark', label: <Label icon={<IconMoon size={14} />} text="Dark" /> },
              { value: 'auto', label: <Label icon={<IconDeviceDesktop size={14} />} text="System" /> },
            ]} />
        </Setting>
      </Section>

      <Section icon={<IconMessageCircle size={18} />} title="Nikolai">
        <Setting label="Voice" description="A Russian voice reading English. Use ▶ to hear a sample.">
          <Radio.Group value={voice} onChange={setNikolaiVoice}>
            <Stack gap="xs">
              {NIKOLAI_VOICES.map((v) => (
                <Group key={v.id} justify="space-between" wrap="nowrap">
                  <Radio value={v.id} label={v.label} description={v.detail} />
                  <Tooltip label={speech.data?.enabled ? `Hear ${v.label}` : speech.data?.reason ?? 'Checking voice…'}>
                    <ActionIcon variant="light" onClick={() => preview(v.id)}
                      disabled={!speech.data?.enabled} aria-label={`Hear ${v.label}`}>
                      <IconPlayerPlay size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
            </Stack>
          </Radio.Group>
        </Setting>
        <Setting label="Pause before sending"
          description="In hands-free chat, what you said is sent after this much silence (or press Enter).">
          <PauseControl value={chatPause} options={CHAT_PAUSE.options} onChange={(n) => setPref(CHAT_PAUSE, n)} />
        </Setting>
      </Section>

      <Section icon={<IconVideo size={18} />} title="Interviews">
        <Setting label="Default pause before an answer is sent"
          description="Preselected when you start an interview; each interview can still choose its own. Shorter pauses train you to keep talking.">
          <PauseControl value={interviewPause} options={INTERVIEW_PAUSE.options}
            onChange={(n) => setPref(INTERVIEW_PAUSE, n)} />
        </Setting>
      </Section>

      <Section icon={<IconCode size={18} />} title="Code editor">
        <Setting label="Code suggestions"
          description="Autocomplete for keywords, built-ins, names in your code and common snippets while you type Java, Python or SQL. Many real interviews turn it off.">
          <Switch checked={codeSuggestions} label={codeSuggestions ? 'On' : 'Off'}
            onChange={(e) => setFlag(CODE_SUGGESTIONS, e.currentTarget.checked)} />
        </Setting>
      </Section>
    </Stack>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card>
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" radius="md">{icon}</ThemeIcon>
        <Title order={4}>{title}</Title>
      </Group>
      <Stack gap="lg">{children}</Stack>
    </Card>
  );
}

function Setting({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div>
      <Text fw={600}>{label}</Text>
      <Text size="sm" c="dimmed" mb="xs">{description}</Text>
      {children}
    </div>
  );
}

function PauseControl({ value, options, onChange }: {
  value: number;
  options: readonly number[];
  onChange: (n: number) => void;
}) {
  return (
    <SegmentedControl value={String(value)} onChange={(v) => onChange(Number(v))}
      data={options.map((n) => ({ value: String(n), label: `${n}s` }))} />
  );
}

function Label({ icon, text }: { icon: ReactNode; text: string }) {
  return <Group gap={6} wrap="nowrap" justify="center">{icon}<span>{text}</span></Group>;
}
