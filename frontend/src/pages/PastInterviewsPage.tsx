import { ActionIcon, Alert, Avatar, Badge, Button, Card, Center, Divider, Group, Loader, Paper, RingProgress, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconCircleCheck, IconClock, IconPlayerPlay, IconPlus, IconRefresh, IconSearch, IconSparkles, IconTrash } from '@tabler/icons-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDate, formatDuration, modeLabel, scoreColor } from '../api';
import { avatarFor } from '../avatar';
import { CompanyLogo } from '../components/CompanyLogo';
import StartInterviewModal from '../components/StartInterviewModal';
import { confirmAction, notifyError } from '../feedback';
import type { InterviewSummary } from '../types';
import { useAsync } from '../useAsync';

/** An original interview and its reattempts, oldest attempt first. */
interface Group {
  id: number;
  attempts: InterviewSummary[];
  latest: InterviewSummary;
}

type StatusFilter = 'ALL' | 'COMPLETED' | 'ABANDONED';
type Sort = 'newest' | 'oldest' | 'score';

/** The dashboard. `starting` (the /interviews/new route) opens the start-interview modal over it. */
export default function PastInterviewsPage({ starting = false }: { starting?: boolean }) {
  const navigate = useNavigate();
  const startModal = <StartInterviewModal opened={starting} onClose={() => navigate('/')} />;
  const past = useAsync(() => api.interviews.list(['COMPLETED', 'ABANDONED']));
  const active = useAsync(() => api.interviews.list(['IN_PROGRESS']));
  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState<string>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<Sort>('newest');

  const reload = () => {
    past.reload();
    active.reload();
  };

  const groups = useMemo(() => groupAttempts(past.data ?? []), [past.data]);
  const companies = useMemo(() => {
    const byId = new Map<number, string>();
    (past.data ?? []).forEach((i) => byId.set(i.companyId, i.companyName));
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [past.data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => companyId === 'ALL' || String(g.latest.companyId) === companyId)
      .filter((g) => status === 'ALL' || g.latest.status === status)
      .filter((g) => !q || [g.latest.candidateName, g.latest.targetRole ?? '', g.latest.companyName, g.latest.roundName ?? '',
        ...g.latest.focusTopics]
        .some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === 'score') return (bestScore(b) ?? -1) - (bestScore(a) ?? -1);
        const diff = Date.parse(b.latest.startedAt) - Date.parse(a.latest.startedAt);
        return sort === 'newest' ? diff : -diff;
      });
  }, [groups, query, companyId, status, sort]);

  const remove = async (i: InterviewSummary) => {
    if (!await confirmAction({ title: `Delete this ${i.companyName} interview?`,
      message: 'It will be removed with its answers and scores.', confirmLabel: 'Delete', danger: true })) return;
    try {
      await api.interviews.remove(i.id);
      reload();
    } catch (err) {
      notifyError(err, 'Could not delete the interview');
    }
  };

  const filtering = query !== '' || companyId !== 'ALL' || status !== 'ALL';

  if (past.data?.length === 0 && active.data?.length === 0) {
    return (
      <>
      {startModal}
      <Center mih="calc(100vh - 160px)">
        <Stack align="center" gap="md" maw={560} ta="center">
          <ThemeIcon size={72} radius="xl" variant="light"><IconSparkles size={40} /></ThemeIcon>
          <Title order={1}>You have not given any interviews yet</Title>
          <Text c="dimmed" size="lg">Practise with AI interviewers that plan questions from your resume and the role.</Text>
          <Button component={Link} to="/interviews/new" size="lg" leftSection={<IconPlayerPlay size={20} />}>
            Start now
          </Button>
        </Stack>
      </Center>
      </>
    );
  }

  return (
    <Stack gap="xl">
      {startModal}
      <Group justify="space-between">
        <Title order={2}>Dashboard</Title>
        <Button component={Link} to="/interviews/new" leftSection={<IconPlus size={16} />}>Start interview</Button>
      </Group>

      {past.data && past.data.length > 0 && <Stats interviews={past.data} />}

      {active.data && active.data.length > 0 && (
        <Stack gap="sm">
          <Title order={3}>In progress</Title>
          {active.data.map((i) => (
            <Card key={i.id} padding="md">
              <Group wrap="nowrap">
                <CompanyLogo company={{ name: i.companyName, logoUrl: i.companyLogoUrl }} size={44} />
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs">
                    <Text fw={600}>{i.companyName}</Text>
                    {i.attempt > 1 && <Badge variant="light" size="sm">Attempt {i.attempt}</Badge>}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {modeLabel(i.mode)} · started {formatDate(i.startedAt)} · {i.attemptedQuestions}/{i.plannedQuestions}{' '}
                    questions attempted
                  </Text>
                </Stack>
                <Button component={Link} to={`/interviews/${i.id}`} leftSection={<IconPlayerPlay size={16} />}>
                  Resume
                </Button>
                {/* Only originals: deleting is per interview, and a reattempt's history belongs to its original. */}
                {i.retakeOfId === null && (
                  <Tooltip label="Delete">
                    <ActionIcon variant="subtle" color="red" size="lg" onClick={() => remove(i)} aria-label="Delete">
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <Stack gap="md">
        <Title order={3}>Past interviews</Title>
        {past.data && past.data.length > 0 && (
          <Group gap="sm">
            <TextInput style={{ flex: '1 1 240px' }} value={query} onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search name, role, company or topic" aria-label="Search interviews"
              leftSection={<IconSearch size={16} />} />
            <Select w={190} value={companyId} onChange={(v) => setCompanyId(v ?? 'ALL')} aria-label="Company"
              allowDeselect={false}
              data={[{ value: 'ALL', label: 'All companies' }, ...companies.map(([id, name]) => ({ value: String(id), label: name }))]} />
            <SegmentedControl value={status} onChange={(v) => setStatus(v as StatusFilter)}
              data={[{ value: 'ALL', label: 'All' }, { value: 'COMPLETED', label: 'Completed' },
                { value: 'ABANDONED', label: 'Abandoned' }]} />
            <Select w={170} value={sort} onChange={(v) => setSort((v ?? 'newest') as Sort)} aria-label="Sort"
              allowDeselect={false}
              data={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
                { value: 'score', label: 'Highest score' }]} />
          </Group>
        )}

        {past.loading && <Loader />}
        {past.error && <Alert color="red">{past.error}</Alert>}
        {past.data?.length === 0 && (
          <Text c="dimmed">No finished interviews yet. Finish the one in progress to see it here.</Text>
        )}
        {filtering && shown.length === 0 && groups.length > 0 && (
          <Text c="dimmed">No interviews match these filters.</Text>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {shown.map((g) => <InterviewCard key={g.id} group={g} />)}
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}

function Stats({ interviews }: { interviews: InterviewSummary[] }) {
  const completed = interviews.filter((i) => i.status === 'COMPLETED');
  const scores = completed.map((i) => i.overallScore ?? 0);
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const best = scores.length ? Math.max(...scores) : null;
  const practice = interviews.reduce((sum, i) => sum + i.answeringSeconds, 0);
  const attempted = interviews.reduce((sum, i) => sum + i.attemptedQuestions, 0);
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="md">
      <Stat label="Completed" value={String(completed.length)} hint={`${interviews.length} total`} />
      <Stat label="Average score" value={average === null ? '—' : String(average)} color={scoreColor(average, 100)} />
      <Stat label="Best score" value={best === null ? '—' : String(best)} color={scoreColor(best, 100)} />
      <Stat label="Questions attempted" value={String(attempted)} />
      <Stat label="Time answering" value={practice ? formatDuration(practice) : '—'} />
    </SimpleGrid>
  );
}

function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text fz={28} fw={700} c={color && color !== 'gray' ? color : undefined} className="tabular">{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}

function InterviewCard({ group }: { group: Group }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const i = group.latest;
  const openReport = () => navigate(`/interviews/${i.id}`);

  const reattempt = async (e: MouseEvent) => {
    e.stopPropagation(); // don't also open the report
    setStarting(true);
    try {
      const next = await api.interviews.reattempt(i.id);
      navigate(`/interviews/${next.id}`);
    } catch (err) {
      notifyError(err, 'Could not start the re-attempt');
      setStarting(false);
    }
  };

  return (
    <Card className="hover-card clickable" role="link" tabIndex={0}
      aria-label={`Open the ${i.companyName} interview report`} onClick={openReport}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openReport(); }}>
      <Group wrap="nowrap" align="center">
        <CompanyLogo company={{ name: i.companyName, logoUrl: i.companyLogoUrl }} size={48} />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={700} truncate>{i.companyName}</Text>
            {group.attempts.length > 1 && <Badge size="xs" variant="light">{group.attempts.length} attempts</Badge>}
          </Group>
          <Text size="sm" c="dimmed" truncate>
            {i.roundName && `${i.roundName} · `}{i.candidateName}{i.targetRole && ` · ${i.targetRole}`} · {modeLabel(i.mode)}
          </Text>
        </Stack>
        {i.status === 'COMPLETED' ? (
          <Tooltip label={`${i.overallScore} out of 100`}>
            <RingProgress size={58} thickness={5} roundCaps
              sections={[{ value: i.overallScore ?? 0, color: scoreColor(i.overallScore, 100) }]}
              label={<Text ta="center" fw={700} size="sm">{i.overallScore}</Text>} />
          </Tooltip>
        ) : <Badge color="gray" variant="outline">Abandoned</Badge>}
      </Group>

      <SimpleGrid cols={2} mt="md">
        <Tooltip label="Main questions answered, out of the questions planned. Follow-ups are not counted.">
          <div>
            <Group gap={4} c="dimmed"><IconCircleCheck size={15} /><Text size="xs">Questions</Text></Group>
            <Text fw={600} className="tabular">
              {i.attemptedQuestions}/{i.plannedQuestions}
              {i.skippedQuestions > 0 && <Text span size="xs" c="dimmed" fw={400}> ({i.skippedQuestions} skipped)</Text>}
            </Text>
          </div>
        </Tooltip>
        <Tooltip label="Interview duration, start to finish">
          <div>
            <Group gap={4} c="dimmed"><IconClock size={15} /><Text size="xs">Duration</Text></Group>
            <Text fw={600} className="tabular">{formatDuration(i.durationSeconds)}</Text>
          </div>
        </Tooltip>
      </SimpleGrid>

      <Divider my="sm" />
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Tooltip label={i.interviewers.map((p) => p.name).join(', ')}>
            <Avatar.Group spacing="sm">
              {i.interviewers.map((p) => <Avatar key={p.id} src={avatarFor(p)} size={28} radius="xl" />)}
            </Avatar.Group>
          </Tooltip>
          <Text size="xs" c="dimmed" truncate>
            {formatDate(i.completedAt ?? i.startedAt)}
          </Text>
        </Group>
        {group.attempts.some((a) => a.reattemptable) && (
          <Tooltip label="Re-attempt: answer the same questions again">
            <ActionIcon variant="light" size="lg" onClick={reattempt} loading={starting} aria-label="Re-attempt">
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Card>
  );
}

/** Groups reattempts under their original; the latest attempt is the one a card shows. */
function groupAttempts(rows: InterviewSummary[]): Group[] {
  const byOriginal = new Map<number, InterviewSummary[]>();
  rows.forEach((r) => {
    const key = r.retakeOfId ?? r.id;
    byOriginal.set(key, [...(byOriginal.get(key) ?? []), r]);
  });
  return [...byOriginal].map(([id, attempts]) => {
    attempts.sort((a, b) => a.attempt - b.attempt);
    return { id, attempts, latest: attempts.at(-1)! };
  });
}

const bestScore = (g: Group) =>
  g.attempts.reduce<number | null>((best, a) =>
    a.overallScore !== null && (best === null || a.overallScore > best) ? a.overallScore : best, null);
