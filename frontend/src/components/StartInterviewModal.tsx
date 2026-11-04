import { Alert, Anchor, Button, FileInput, Group, Modal, Paper, Select, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Textarea, ThemeIcon, Title } from '@mantine/core';
import { IconAdjustments, IconFileText, IconPlayerPlay, IconUser } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import TopicPicker from './TopicPicker';
import type { InterviewMode } from '../types';
import { INTERVIEW_PAUSE, usePref } from '../preferences';
import { useAsync } from '../useAsync';

type Field = 'candidateName' | 'targetRole' | 'jobDescription' | 'companyId' | 'mode' | 'answerPauseSeconds' | 'roundName'
  | 'roundDescription' | 'topics' | 'resume';
type Errors = Partial<Record<Field, string>>;

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const MIN_JOB_DESCRIPTION = 50;
const MAX_ROUND_NAME = 100;
const MAX_ROUND_DESCRIPTION = 2000;

/** Seconds of silence before a hands-free answer is submitted (the backend accepts 3-60). */
const PAUSE_OPTIONS = INTERVIEW_PAUSE.options;

/** Shown in turn while the server checks the details and Claude plans the interview. */
const STAGES = ['Checking your details…', 'Planning your interview…', 'Writing your questions…',
  'Briefing your interviewers…'];

/**
 * The start-interview form in a large modal: details about the candidate on the left, interview settings (company,
 * format, round, focus topics) on the right. Opened by the /interviews/new route over the dashboard.
 */
export default function StartInterviewModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: companies } = useAsync(api.companies.list);
  const { data: topicCatalog } = useAsync(api.topics.catalog);
  const [candidateName, setCandidateName] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [mode, setMode] = useState<InterviewMode>('ONE_ON_ONE');
  const [roundName, setRoundName] = useState('');
  const [roundDescription, setRoundDescription] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const defaultPause = usePref(INTERVIEW_PAUSE);
  const [answerPause, setAnswerPause] = useState(String(defaultPause));
  // Each time the dialog opens, start from the current default (Settings → Preferences).
  useEffect(() => {
    if (opened) setAnswerPause(String(defaultPause));
  }, [opened, defaultPause]);
  const [resume, setResume] = useState<File | null>(null);
  const [starting, setStarting] = useState(false);
  const [stage, setStage] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!starting) return;
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2500);
    return () => clearInterval(timer);
  }, [starting]);

  const selected = companies?.find((c) => c.id === companyId);
  const missingSetup = companies !== null && !companies.some((c) => c.interviewerCount > 0);

  /** The same checks the server makes, so most problems show up without a round trip. */
  const check = (): Errors => {
    const found: Errors = {};
    if (!candidateName.trim()) found.candidateName = 'Enter your name.';
    else if (candidateName.trim().length > 100) found.candidateName = 'Name must be 100 characters or fewer.';
    if (targetRole.trim().length > 150) found.targetRole = 'Target role must be 150 characters or fewer.';
    const jd = jobDescription.trim();
    if (jd && jd.length < MIN_JOB_DESCRIPTION) {
      found.jobDescription = `That's too short to be a job description (at least ${MIN_JOB_DESCRIPTION} characters). `
        + 'Paste the full posting or leave it empty.';
    }
    if (roundName.trim().length > MAX_ROUND_NAME) {
      found.roundName = `Round name must be ${MAX_ROUND_NAME} characters or fewer.`;
    }
    if (roundDescription.trim().length > MAX_ROUND_DESCRIPTION) {
      found.roundDescription = `Round description must be ${MAX_ROUND_DESCRIPTION} characters or fewer.`;
    }
    if (topicCatalog && topics.length > topicCatalog.maxTopics) {
      found.topics = `Choose at most ${topicCatalog.maxTopics} topics.`;
    }
    if (!selected) found.companyId = 'Choose a company.';
    else if (selected.interviewerCount === 0) found.companyId = `${selected.name} has no interviewers yet.`;
    else if (mode === 'PANEL' && selected.interviewerCount < 2) {
      found.companyId = `${selected.name} has only one interviewer, but a panel needs at least 2.`;
    }
    if (!resume) found.resume = 'Upload your resume.';
    else if (resume.size > MAX_RESUME_BYTES) found.resume = 'Resume must be 10 MB or smaller.';
    else if (!/\.(pdf|txt|md)$/i.test(resume.name)) found.resume = 'Resume must be a PDF or a .txt/.md file.';
    return found;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = check();
    setErrors(found);
    setError(null);
    if (Object.keys(found).length > 0 || !resume || companyId === '') return;
    setStarting(true);
    try {
      const interview = await api.interviews.start({
        candidateName, targetRole, jobDescription, companyId, mode, roundName, roundDescription, topics, resume,
        answerPauseSeconds: Number(answerPause),
      });
      navigate(`/interviews/${interview.id}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.errors).length > 0) setErrors(err.errors as Errors);
      else setError((err as Error).message);
      setStarting(false);
    }
  };

  // Editing a field clears its error.
  const clear = (field: Field) => setErrors(({ [field]: _, ...rest }) => rest);

  return (
    <Modal opened={opened} onClose={onClose} size="min(1200px, calc(100vw - 48px))" padding="xl"
      centered closeOnClickOutside={!starting} closeOnEscape={!starting} withCloseButton={!starting}
      title={
        <Group gap="xs">
          <IconPlayerPlay size={20} color="var(--mantine-primary-color-filled)" />
          <Title order={3}>Start a mock interview</Title>
        </Group>
      }>
      <Text c="dimmed" mt={-8} mb="lg">
        Your interviewers plan the questions up front from your resume, the role and the company.
      </Text>
      {missingSetup && (
        <Alert color="yellow" mb="md">
          Add a <Anchor component={Link} to="/companies">company</Anchor> with at least one interviewer before starting.
        </Alert>
      )}
      <form onSubmit={submit} noValidate>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="md">
            <SectionTitle icon={<IconUser size={16} />} title="About you" />
            <TextInput label="Your name" required value={candidateName} error={errors.candidateName}
              onChange={(e) => { setCandidateName(e.currentTarget.value); clear('candidateName'); }} />
            <FileInput label="Resume" description="PDF or .txt, up to 10 MB" required placeholder="Choose your resume"
              accept=".pdf,.txt,.md,application/pdf,text/plain" value={resume} error={errors.resume} clearable
              leftSection={<IconFileText size={16} />}
              onChange={(f) => { setResume(f); clear('resume'); }} />
            <Select label="Company" required placeholder="Select a company…" searchable
              value={companyId === '' ? null : String(companyId)} error={errors.companyId}
              onChange={(v) => { setCompanyId(v ? Number(v) : ''); clear('companyId'); }}
              data={(companies ?? []).map((c) => ({
                value: String(c.id),
                label: `${c.name}${c.interviewerCount === 0 ? ' (no interviewers yet)' : ''}`,
                disabled: c.interviewerCount === 0,
              }))} />
            {errors.companyId && selected && (
              <Anchor component={Link} to={`/companies/${selected.id}`} size="sm" mt={-8}>
                Add interviewers to {selected.name}
              </Anchor>
            )}
            <TextInput label="Target role" value={targetRole} placeholder="Senior Backend Engineer"
              error={errors.targetRole}
              onChange={(e) => { setTargetRole(e.currentTarget.value); clear('targetRole'); }} />
            <Textarea label="Job description" description="Tailors questions to the posting's requirements"
              autosize minRows={8} maxRows={16} maxLength={20000} value={jobDescription} error={errors.jobDescription}
              onChange={(e) => { setJobDescription(e.currentTarget.value); clear('jobDescription'); }}
              placeholder="Paste the job posting" />
          </Stack>

          <Paper withBorder p="lg" className="settings-panel">
            <Stack gap="md">
              <SectionTitle icon={<IconAdjustments size={16} />} title="Interview settings" />
              <Stack gap={4}>
                <Text size="sm" fw={500}>Format</Text>
                <SegmentedControl value={mode} fullWidth
                  onChange={(m) => { setMode(m as InterviewMode); clear('mode'); clear('companyId'); }}
                  data={[{ value: 'ONE_ON_ONE', label: 'One-on-one' }, { value: 'PANEL', label: 'Panel' }]} />
                {errors.mode && <Text size="xs" c="red">{errors.mode}</Text>}
                <Text size="xs" c="dimmed">
                  The AI picks the company's interviewers who best fit your resume, role and round, and who asks what: an introduction, then the main questions.
                </Text>
              </Stack>
              <TextInput label="Round name" value={roundName} maxLength={MAX_ROUND_NAME}
                placeholder="Round 2 – Backend deep dive" error={errors.roundName}
                onChange={(e) => { setRoundName(e.currentTarget.value); clear('roundName'); }} />
              <Textarea label="Round description" autosize minRows={2} maxRows={6}
                maxLength={MAX_ROUND_DESCRIPTION} value={roundDescription} error={errors.roundDescription}
                placeholder="What this round covers and how it's run, e.g. focus on trade-offs and production experience, no puzzles"
                onChange={(e) => { setRoundDescription(e.currentTarget.value); clear('roundDescription'); }} />
              <TopicPicker catalog={topicCatalog} value={topics} error={errors.topics}
                onChange={(t) => { setTopics(t); clear('topics'); }}
                description={topics.length > 0
                  ? 'Every main question is about these topics, shared out in this order. Follow-ups stay on topic.'
                  : 'Leave empty to let the round, your resume and the company guide the questions.'} />
              <Stack gap={4}>
                <Text size="sm" fw={500}>Pause before your answer is sent</Text>
                <SegmentedControl value={answerPause} fullWidth onChange={(v) => { setAnswerPause(v); clear('answerPauseSeconds'); }}
                  data={PAUSE_OPTIONS.map((s) => ({ value: String(s), label: `${s}s` }))} />
                {errors.answerPauseSeconds && <Text size="xs" c="red">{errors.answerPauseSeconds}</Text>}
                <Text size="xs" c="dimmed">
                  In hands-free mode, your answer is submitted once you have been silent this long; speaking again
                  resets the timer. A shorter pause trains you to keep talking: in a real interview, long silences
                  between thoughts come across as hesitation, so practise thinking out loud. Start at 10s and work
                  down to 5s. Set your default in Settings → Preferences.
                </Text>
              </Stack>
            </Stack>
          </Paper>
        </SimpleGrid>

        <Stack gap="xs" mt="xl">
          {Object.keys(errors).length > 0 && <Alert color="red">Please fix the highlighted fields.</Alert>}
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end" gap="sm">
            {starting && (
              <Text size="sm" c="dimmed">{STAGES[stage]} This can take up to a minute.</Text>
            )}
            <Button variant="default" onClick={onClose} disabled={starting}>Cancel</Button>
            <Button type="submit" size="md" loading={starting} disabled={missingSetup}
              leftSection={<IconPlayerPlay size={18} />} loaderProps={{ type: 'dots' }}>
              Start interview
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Group gap="xs">
      <ThemeIcon variant="light" size="md" radius="md">{icon}</ThemeIcon>
      <Title order={5}>{title}</Title>
    </Group>
  );
}
