import { Accordion, Anchor, Avatar, Badge, Box, Button, Card, Group, Image, List, Paper, RingProgress, SimpleGrid, Stack, Table, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconArrowUpRight, IconCheck, IconFileText, IconMessageCircle, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDate, formatDuration, modeLabel, scoreColor } from '../api';
import { avatarFor } from '../avatar';
import AskAi from '../components/AskAi';
import { ScoreBadge } from '../components/ScoreBadge';
import { confirmAction, notifyError } from '../feedback';
import type { InterviewDetail } from '../types';
import { useAsync } from '../useAsync';

export default function InterviewReport({ interview }: { interview: InterviewDetail }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const attempts = useAsync(() => api.interviews.attempts(interview.id), [interview.id]);

  // Compare against the latest completed attempt before this one.
  const previous = attempts.data
    ?.filter((a) => a.attempt < interview.attempt && a.status === 'COMPLETED')
    .at(-1);
  const previousDetail = useAsync(
    () => (previous ? api.interviews.get(previous.id) : Promise.resolve(null)),
    [previous?.id],
  );
  // Every attempt shares the plan, so questions line up by position.
  const previousScore = (position: number) =>
    previousDetail.data?.questions.find((q) => q.position === position)?.score ?? null;
  // Reattempts copy the round, so topics line up by name.
  const previousTopicScore = (topic: string) =>
    previousDetail.data?.topicResults.find((t) => t.topic === topic)?.averageScore ?? null;

  // Back to wherever the user came from; home if they opened this report directly (no in-app history).
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  const attemptCount = attempts.data?.length ?? 1;

  /** Deleting the original removes the whole interview, every attempt included. */
  const deleteInterview = async () => {
    const ok = await confirmAction({
      title: `Delete this ${interview.companyName} interview?`,
      message: attemptCount > 1
        ? `All ${attemptCount} attempts will be deleted with their answers, scores and AI answers.`
        : 'It will be deleted with its answers, scores and AI answers.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      // The backend deletes the whole interview, whichever attempt this is.
      await api.interviews.remove(interview.id);
      navigate('/');
    } catch (err) {
      notifyError(err, 'Could not delete the interview');
    }
  };

  const reattempt = async () => {
    setStarting(true);
    try {
      const next = await api.interviews.reattempt(interview.id);
      navigate(`/interviews/${next.id}`);
    } catch (err) {
      notifyError(err, 'Could not start the re-attempt');
      setStarting(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={16} />} onClick={goBack} px="xs">
          Back
        </Button>
        <Group gap="xs">
          <Tooltip label="Delete the original interview and every attempt of it">
            <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={deleteInterview}>
              Delete
            </Button>
          </Tooltip>
          {/* Completed and abandoned interviews alike; every attempt replays the original's questions. */}
          {interview.reattemptable && (
            <Tooltip label="Answer exactly the same questions again and try for a better score">
              <Button leftSection={<IconRefresh size={16} />} onClick={reattempt} loading={starting}>Re-attempt</Button>
            </Tooltip>
          )}
        </Group>
      </Group>

      <Card p="xl">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xl">
          <Stack gap="xs" style={{ minWidth: 0 }}>
            <Group gap="xs">
              <Title order={2}>{interview.candidateName} · {interview.companyName}</Title>
              {interview.attempt > 1 && <Badge variant="light">Attempt {interview.attempt}</Badge>}
            </Group>
            <Text c="dimmed">
              {interview.roundName && `${interview.roundName} · `}
              {interview.targetRole && `${interview.targetRole} · `}
              {modeLabel(interview.mode)} interview
            </Text>
            {interview.roundDescription && <Text size="sm">{interview.roundDescription}</Text>}
            {interview.focusTopics.length > 0 && (
              <Group gap={6}>{interview.focusTopics.map((t) => <Badge key={t} variant="light">{t}</Badge>)}</Group>
            )}
            <Group gap="md" mt={4}>
              {interview.interviewers.map((i) => (
                <Group key={i.id} gap={6}>
                  <Avatar src={avatarFor(i)} size={28} radius="xl" />
                  <Text size="sm">{i.name}</Text>
                </Group>
              ))}
            </Group>
            <Text size="sm" c="dimmed">
              {formatDate(interview.startedAt)} · {interview.attemptedQuestions}/{interview.plannedQuestions} questions
              attempted{interview.skippedQuestions > 0 && ` · ${interview.skippedQuestions} skipped`}
              {interview.durationSeconds !== null && ` · Session ${formatDuration(interview.durationSeconds)}`}
              {interview.answeringSeconds > 0 && ` · Answering ${formatDuration(interview.answeringSeconds)}`}
              {interview.resumeFileName && (
                <> · <Anchor href={api.interviews.resumeUrl(interview.id)} target="_blank" rel="noreferrer" size="sm">
                  Resume
                </Anchor></>
              )}
            </Text>
          </Stack>
          {interview.status === 'COMPLETED' ? (
            <RingProgress size={130} thickness={10} roundCaps
              sections={[{ value: interview.overallScore ?? 0, color: scoreColor(interview.overallScore, 100) }]}
              label={
                <Stack gap={0} align="center">
                  <Text fz={32} fw={800} lh={1}>{interview.overallScore}</Text>
                  <Text size="xs" c="dimmed">out of 100</Text>
                </Stack>
              } />
          ) : <Badge color="gray" variant="outline" size="lg">Abandoned</Badge>}
        </Group>
      </Card>

      {attempts.data && attempts.data.length > 1 && (
        <Card>
          <Title order={4} mb="sm">Attempts</Title>
          <Group gap="sm">
            {attempts.data.map((a) => {
              const current = a.id === interview.id;
              return (
                <Paper key={a.id} component={Link} to={`/interviews/${a.id}`} withBorder p="sm" miw={110}
                  className={`attempt-chip ${current ? 'current' : ''}`}>
                  <Text size="xs" c="dimmed">#{a.attempt}</Text>
                  <Text fw={700} c={a.status === 'COMPLETED' ? scoreColor(a.overallScore, 100) : 'dimmed'}>
                    {a.status === 'COMPLETED' ? a.overallScore : a.status === 'IN_PROGRESS' ? 'In progress' : '—'}
                  </Text>
                  <Text size="xs" c="dimmed">{formatDate(a.completedAt ?? a.startedAt)}</Text>
                </Paper>
              );
            })}
          </Group>
        </Card>
      )}

      {interview.jobDescription && (
        <Accordion variant="separated">
          <Accordion.Item value="jd">
            <Accordion.Control icon={<IconFileText size={18} />}>Job description</Accordion.Control>
            <Accordion.Panel><Text size="sm" className="pre-wrap">{interview.jobDescription}</Text></Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {interview.summary && (
        <Card>
          <Title order={3} mb="xs">Summary</Title>
          <Text>{interview.summary}</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} mt="lg" spacing="xl">
            <div>
              <Title order={5} mb="xs" c="teal">Strengths</Title>
              <List spacing="xs" icon={<ThemeIcon color="teal" size={20} radius="xl"><IconCheck size={13} /></ThemeIcon>}>
                {interview.strengths.map((s, i) => <List.Item key={i}>{s}</List.Item>)}
              </List>
            </div>
            <div>
              <Title order={5} mb="xs" c="orange">To improve</Title>
              <List spacing="xs" icon={<ThemeIcon color="orange" size={20} radius="xl"><IconArrowUpRight size={13} /></ThemeIcon>}>
                {interview.improvements.map((s, i) => <List.Item key={i}>{s}</List.Item>)}
              </List>
            </div>
          </SimpleGrid>
        </Card>
      )}

      {interview.topicResults.length > 0 && (
        <Card>
          <Title order={3} mb="sm">By topic</Title>
          <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Topic</Table.Th><Table.Th>Questions</Table.Th><Table.Th>Answered</Table.Th>
                  <Table.Th>Skipped</Table.Th><Table.Th>Average</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {interview.topicResults.map((t) => {
                  const was = previous ? previousTopicScore(t.topic) : null;
                  return (
                    <Table.Tr key={t.topic}>
                      <Table.Td fw={600}>{t.topic}</Table.Td>
                      <Table.Td>{t.questions}</Table.Td>
                      <Table.Td>{t.answered}</Table.Td>
                      <Table.Td>{t.skipped}</Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          {t.averageScore === null ? <Text c="dimmed">—</Text> : (
                            <Badge color={scoreColor(t.averageScore, 10)} variant="light">{t.averageScore}/10</Badge>
                          )}
                          {was !== null && (
                            <Tooltip label={`Average in attempt ${previous!.attempt}`}>
                              <Text size="xs" c="dimmed">was {was}</Text>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed" mt="xs">Averages include follow-ups; skipped questions count as 0.</Text>
        </Card>
      )}

      <Title order={3} mt="sm">Questions</Title>
      <Stack gap="md">
        {interview.questions.map((q) => (
          <Card key={q.id} className={q.status === 'NOT_ATTEMPTED' ? 'not-attempted' : undefined}>
            <Group justify="space-between" wrap="nowrap" align="center" mb="sm">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Badge variant="filled" size="lg">Q{q.position}</Badge>
                <Avatar src={avatarFor(q.askedBy)} size={28} radius="xl" />
                <Text fw={600} size="sm">{q.askedBy.name}</Text>
                {q.topic && <Badge variant="light" color="gray">{q.topic}</Badge>}
              </Group>
              <Group gap="sm" wrap="nowrap">
                {previous && previousScore(q.position) !== null && (
                  <Tooltip label={`Score in attempt ${previous.attempt}`}>
                    <Text size="xs" c="dimmed">was {previousScore(q.position)}/10</Text>
                  </Tooltip>
                )}
                <AskAi label={`Q${q.position}`} question={q.question} initial={q.studyGuide}
                  answer={q.status === 'ANSWERED' && q.answer ? { text: q.answer, given: true }
                    : { text: q.status === 'SKIPPED' ? 'You skipped this question.' : 'You did not reach this question.', given: false }}
                  score={q.score}
                  load={() => api.interviews.studyGuide(interview.id, q.id)} />
                <ScoreBadge status={q.status} score={q.score} />
              </Group>
            </Group>
            <QA question={q.question} answer={q.status === 'ANSWERED' ? q.answer : null}
              placeholder={q.status === 'SKIPPED' ? 'You skipped this question.'
                : q.status === 'NOT_ATTEMPTED' ? 'Not attempted in this attempt.' : null}
              feedback={q.feedback} whiteboardUrl={q.status === 'ANSWERED' ? q.whiteboardUrl : null}
              time={q.responseSeconds !== null
                ? `${q.status === 'SKIPPED' ? 'Skipped after' : 'Answered in'} ${formatDuration(q.responseSeconds)}` : null} />

            {q.followUps.map((f, n) => (
              <Box key={f.id} className="follow-up" mt="md">
                <Group justify="space-between" wrap="nowrap" mb="xs">
                  <Group gap="xs" wrap="nowrap">
                    <Avatar src={avatarFor(f.askedBy)} size={24} radius="xl" />
                    <Text fw={600} size="sm">{f.askedBy.name}</Text>
                    <Badge variant="light" size="sm" leftSection={<IconMessageCircle size={12} />}>
                      Follow-up {n + 1}
                    </Badge>
                  </Group>
                  <Group gap="sm" wrap="nowrap">
                    {(f.answer || f.skipped) && (
                      <AskAi label={`Q${q.position} · Follow-up ${n + 1}`} question={f.question}
                        answer={f.answer ? { text: f.answer, given: true } : { text: 'You skipped this follow-up.', given: false }}
                        score={f.score}
                        initial={f.studyGuide} load={() => api.interviews.followUpStudyGuide(interview.id, f.id)} />
                    )}
                    <ScoreBadge status={f.skipped ? 'SKIPPED' : f.answer ? 'ANSWERED' : 'CURRENT'} score={f.score} />
                  </Group>
                </Group>
                <QA question={f.question} answer={f.answer} placeholder={f.skipped ? 'You skipped this follow-up.' : null}
                  feedback={f.skipped ? null : f.feedback} whiteboardUrl={f.whiteboardUrl} time={null} />
              </Box>
            ))}
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}

/** A question, the candidate's answer (or why there is none), the interviewer's feedback and timing. */
function QA({ question, answer, placeholder, feedback, whiteboardUrl, time }: {
  question: string;
  answer: string | null;
  placeholder: string | null;
  feedback: string | null;
  /** The whiteboard drawn with this answer, if any. */
  whiteboardUrl?: string | null;
  time: string | null;
}) {
  return (
    <Stack gap="xs">
      <Text fw={500}>{question}</Text>
      {answer && <Paper p="sm" className="answer-box"><Text size="sm" className="pre-wrap">{answer}</Text></Paper>}
      {whiteboardUrl && (
        <Anchor href={whiteboardUrl} target="_blank" rel="noreferrer" w="fit-content">
          <Image src={whiteboardUrl} alt="Your whiteboard" className="report-board" />
        </Anchor>
      )}
      {!answer && placeholder && <Paper p="sm" className="answer-box"><Text size="sm" c="dimmed">{placeholder}</Text></Paper>}
      {feedback && <Text size="sm" c="dimmed" fs="italic">{feedback}</Text>}
      {time && <Text size="xs" c="dimmed">{time}</Text>}
    </Stack>
  );
}
