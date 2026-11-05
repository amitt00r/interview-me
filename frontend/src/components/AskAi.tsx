import { ActionIcon, Alert, Anchor, Badge, Button, Group, Loader, Modal, Paper, ScrollArea, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconSearch, IconSparkles } from '@tabler/icons-react';
import { useState } from 'react';
import { scoreColor } from '../api';
import type { CodeSubmission, StudyGuide } from '../types';
import { CodeBlock, splitFences } from './CodeBlock';

const googleSearchUrl = (topic: string) => `https://www.google.com/search?q=${encodeURIComponent(topic)}`;

/**
 * "Ask AI" button for a report answer (main question or follow-up). Opens a large modal comparing the candidate's
 * answer (left) with a better answer (right), plus what to read up on. Claude writes the better answer on the first
 * open (it takes a few seconds), then it is stored and shows instantly.
 */
export default function AskAi({ label, question, answer, code = null, score, initial, load }: {
  /** Which question this is, e.g. "Q2" or "Q2 · Follow-up 1". */
  label: string;
  question: string;
  /** The candidate's answer, or what happened instead ("You skipped this question."). */
  answer: { text: string; given: boolean };
  /** Code the candidate submitted with the answer, if any. */
  code?: CodeSubmission | null;
  score: number | null;
  initial: StudyGuide | null;
  load: () => Promise<StudyGuide>;
}) {
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState<StudyGuide | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGuide = async () => {
    setLoading(true);
    setError(null);
    try {
      setGuide(await load());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    if (!guide && !loading) void fetchGuide();
  };

  return (
    <>
      <Tooltip label="See a better answer and what to read up on">
        <Button size="compact-sm" variant="light" onClick={openModal}
          leftSection={loading ? <Loader size={12} /> : <IconSparkles size={14} />}>
          {loading ? 'Thinking…' : 'Ask AI'}
        </Button>
      </Tooltip>

      <Modal opened={open} onClose={() => setOpen(false)} size="min(1760px, calc(100vw - 64px))"
        centered padding="xl"
        title={
          <Group gap="xs">
            <IconSparkles size={20} color="var(--mantine-primary-color-filled)" />
            <Title order={4} c="var(--mantine-primary-color-filled)">Ask AI</Title>
            <Badge variant="light">{label}</Badge>
          </Group>
        }>
        <Stack gap="lg">
          <Paper withBorder p="md" className="ask-ai-question">
            <Text size="xs" fw={700} tt="uppercase" c="var(--mantine-primary-color-filled)" mb={6}>Question</Text>
            <Text fz="lg" fw={600} lh={1.5}>{question}</Text>
          </Paper>

          {/* Fixed-height panes; each scrolls its own text while its heading stays put. */}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <Paper withBorder p="md" className="ask-ai-pane">
              <Group gap="xs" mb="sm">
                <Text fw={700}>Your answer</Text>
                {answer.given && score !== null && (
                  <Badge color={scoreColor(score, 10)} variant="light">{score}/10</Badge>
                )}
              </Group>
              <ScrollArea className="ask-ai-scroll" offsetScrollbars>
                <Text className="pre-wrap" lh={1.6} c={answer.given ? undefined : 'dimmed'}>{answer.text}</Text>
                {code && <CodeBlock code={code} mt="sm" />}
              </ScrollArea>
            </Paper>
            <Paper p="md" className="ask-ai-pane better">
              <Group gap="xs" mb="sm">
                <IconSparkles size={16} color="var(--mantine-primary-color-filled)" />
                <Text fw={700} c="var(--mantine-primary-color-filled)">Better answer</Text>
              </Group>
              <ScrollArea className="ask-ai-scroll" offsetScrollbars>
                {loading && (
                  <Group gap="sm"><Loader size="sm" type="dots" />
                    <Text c="dimmed">Writing a better answer for you… this takes a few seconds.</Text>
                  </Group>
                )}
                {error && (
                  <Alert color="red" title="Could not get an answer">
                    {error} <Anchor component="button" onClick={fetchGuide}>Try again</Anchor>
                  </Alert>
                )}
                {guide && <ModelAnswer text={guide.modelAnswer} />}
              </ScrollArea>
            </Paper>
          </SimpleGrid>

          {guide && guide.studyTopics.length > 0 && (
            <div>
              <Title order={5} c="var(--mantine-primary-color-filled)" mb="xs">Read up on</Title>
              <Stack gap={6}>
                {guide.studyTopics.map((t, i) => (
                  <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                    <Text fw={700} c="dimmed" w={20}>{i + 1}.</Text>
                    <Text size="sm" style={{ flex: 1 }}>
                      <Text span fw={600}>{t.topic}</Text>
                      <Tooltip label={`Search Google for "${t.topic}"`}>
                        <ActionIcon component="a" href={googleSearchUrl(t.topic)} target="_blank" rel="noreferrer"
                          variant="light" size="sm" mx={6} className="inline-icon"
                          aria-label={`Search Google for ${t.topic}`}>
                          <IconSearch size={13} />
                        </ActionIcon>
                      </Tooltip>
                      {t.reason && <Text span c="dimmed">— {t.reason}</Text>}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </div>
          )}
        </Stack>
      </Modal>
    </>
  );
}

/** The better answer: prose, with any fenced code blocks highlighted. */
function ModelAnswer({ text }: { text: string }) {
  return (
    <Stack gap="sm">
      {splitFences(text).map((part, i) => part.code
        ? <CodeBlock key={i} code={part.text} language={part.language} />
        : part.text.trim() && <Text key={i} className="pre-wrap" lh={1.6}>{part.text.trim()}</Text>)}
    </Stack>
  );
}
