import { Alert, Anchor, Avatar, Button, Card, Group, Loader, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconMicrophone, IconPencil, IconPlayerStop, IconPlus, IconTrash, IconVolume } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { avatarFor } from '../avatar';
import { CompanyForm } from '../components/CompanyForm';
import { CompanyLogo } from '../components/CompanyLogo';
import { InterviewerForm, type PhotoChange } from '../components/InterviewerForm';
import { confirmAction, notifyError } from '../feedback';
import { checkSpeech, speak, stopSpeaking } from '../speech';
import type { CompanyInput, Interviewer, InterviewerInput } from '../types';
import { useAsync } from '../useAsync';
import { voiceFor, voiceLabel } from '../voices';

/** A company's details and its interview panel. `/companies/new` renders just the create form. */
export default function CompanyPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  if (id === 'new') {
    const create = async (input: CompanyInput) => {
      const c = await api.companies.create(input);
      navigate(`/companies/${c.id}`, { replace: true });
    };
    return (
      <Card maw={720} mx="auto">
        <Title order={2} mb="md">Add a company</Title>
        <CompanyForm company={null} onSave={create} onCancel={() => navigate('/companies')} />
      </Card>
    );
  }
  return <CompanyDetail key={id} companyId={Number(id)} />;
}

function CompanyDetail({ companyId }: { companyId: number }) {
  const navigate = useNavigate();
  const company = useAsync(() => api.companies.get(companyId), [companyId]);
  const panel = useAsync(() => api.interviewers.list(companyId), [companyId]);
  const [editingCompany, setEditingCompany] = useState(false);
  // null = no form open, 'new' = adding, otherwise the interviewer being edited.
  const [interviewerForm, setInterviewerForm] = useState<Interviewer | 'new' | null>(null);
  const speech = useAsync(checkSpeech);
  // The interviewer whose voice is playing.
  const [playingId, setPlayingId] = useState<number | null>(null);

  useEffect(() => stopSpeaking, []);

  const c = company.data;
  if (company.error) return <Alert color="red">{company.error}</Alert>;
  if (!c) return <Loader />;

  const saveCompany = async (input: CompanyInput) => {
    company.setData(await api.companies.update(c.id, input));
    setEditingCompany(false);
  };

  const deleteCompany = async () => {
    if (!await confirmAction({ title: `Delete ${c.name}?`, message: 'The company and its interviewers will be removed.',
      confirmLabel: 'Delete', danger: true })) return;
    try {
      await api.companies.remove(c.id);
      navigate('/companies');
    } catch (err) {
      notifyError(err, 'Could not delete the company');
    }
  };

  const saveInterviewer = async (input: InterviewerInput, photo: PhotoChange) => {
    if (!interviewerForm) return;
    const saved = interviewerForm === 'new'
      ? await api.interviewers.create(input)
      : await api.interviewers.update(interviewerForm.id, input);
    if (photo && 'upload' in photo) {
      try {
        await api.interviewers.uploadPhoto(saved.id, photo.upload);
      } catch (err) {
        // The details are saved; reopen as an edit so retrying doesn't create a duplicate.
        setInterviewerForm(saved);
        panel.reload();
        notifyError(err, `${saved.name} was saved, but the photo upload failed`);
        return;
      }
    } else if (photo) {
      await api.interviewers.removePhoto(saved.id);
    }
    setInterviewerForm(null);
    panel.reload();
    company.reload();
  };

  /** Plays a short introduction in the interviewer's voice; clicking again stops it. */
  const playVoice = async (i: Interviewer) => {
    if (playingId === i.id) {
      stopSpeaking();
      setPlayingId(null);
      return;
    }
    stopSpeaking();
    setPlayingId(i.id);
    try {
      await speak(`Hi, I'm ${i.name}${i.title ? `, ${i.title}` : ''} at ${c.name}. Let's get started with your interview.`,
        voiceFor(i));
    } catch (err) {
      notifyError(err, 'Could not play the voice');
    } finally {
      setPlayingId((id) => (id === i.id ? null : id));
    }
  };

  const removeInterviewer = async (i: Interviewer) => {
    if (!await confirmAction({ title: `Delete ${i.name}?`, message: 'They will no longer be picked for interviews.',
      confirmLabel: 'Delete', danger: true })) return;
    try {
      await api.interviewers.remove(i.id);
      panel.reload();
      company.reload();
    } catch (err) {
      notifyError(err, 'Could not delete the interviewer');
    }
  };

  return (
    <Stack gap="lg" maw={960} mx="auto">
      <Anchor component={Link} to="/companies" size="sm">
        <Group gap={4}><IconArrowLeft size={16} /> All companies</Group>
      </Anchor>

      <Card>
        <Group align="center" gap="lg" mb={editingCompany ? 'md' : 0} wrap="wrap">
          <CompanyLogo company={c} size={80} />
          <Stack gap={2} style={{ flex: 1, minWidth: 160 }}>
            <Title order={2}>{c.name}</Title>
            {c.industry && <Text c="dimmed">{c.industry}</Text>}
          </Stack>
          {!editingCompany && (
            <Group gap="xs">
              <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditingCompany(true)}>
                Edit details
              </Button>
              <Button variant="light" color="red" leftSection={<IconTrash size={16} />} onClick={deleteCompany}>
                Delete
              </Button>
            </Group>
          )}
        </Group>
        {editingCompany ? (
          <CompanyForm company={c} onSave={saveCompany} onCancel={() => setEditingCompany(false)} />
        ) : (
          <Stack gap="md" mt="lg">
            {c.description && (
              <div><Text fw={600} mb={4}>About</Text><Text className="pre-wrap">{c.description}</Text></div>
            )}
            {c.interviewFocus && (
              <div><Text fw={600} mb={4}>Interview focus</Text><Text className="pre-wrap">{c.interviewFocus}</Text></div>
            )}
            {!c.description && !c.interviewFocus && (
              <Text c="dimmed">No details yet. Add them so interviewers know what this company looks for.</Text>
            )}
          </Stack>
        )}
      </Card>

      <Group justify="space-between">
        <Title order={3}>Interviewers</Title>
        {interviewerForm === null && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setInterviewerForm('new')}>Add interviewer</Button>
        )}
      </Group>
      {interviewerForm !== null && (
        <Card>
          <InterviewerForm key={interviewerForm === 'new' ? 'new' : interviewerForm.id}
            interviewer={interviewerForm === 'new' ? null : interviewerForm} companyId={c.id}
            onSave={saveInterviewer} onCancel={() => setInterviewerForm(null)} />
        </Card>
      )}
      {panel.error && <Alert color="red">{panel.error}</Alert>}
      {panel.data?.length === 0 && interviewerForm === null && (
        <Text c="dimmed">No interviewers yet. Add at least one for one-on-one interviews, two for panels.</Text>
      )}
      <Stack gap="md">
        {panel.data?.map((i) => (
          <Card key={i.id}>
            <Group align="flex-start" gap="lg" wrap="nowrap">
              <Avatar src={avatarFor(i)} size={88} radius="md" alt={i.name} />
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div>
                    <Title order={4}>{i.name}</Title>
                    <Text size="sm" c="dimmed">
                      {[i.title, i.yearsOfExperience ? `${i.yearsOfExperience} yrs` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </div>
                  <Group gap="xs" wrap="nowrap">
                    <Tooltip label={speech.data?.enabled ? `Hear ${i.name}'s voice` : speech.data?.reason ?? 'Checking voice…'}>
                      <Button size="xs" variant={playingId === i.id ? 'filled' : 'light'} disabled={!speech.data?.enabled}
                        onClick={() => playVoice(i)}
                        leftSection={playingId === i.id ? <IconPlayerStop size={14} /> : <IconVolume size={14} />}>
                        {playingId === i.id ? 'Stop' : 'Voice'}
                      </Button>
                    </Tooltip>
                    <Button size="xs" variant="default" leftSection={<IconPencil size={14} />}
                      onClick={() => setInterviewerForm(i)}>Edit</Button>
                    <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />}
                      onClick={() => removeInterviewer(i)}>Delete</Button>
                  </Group>
                </Group>
                {i.expertise && <Text size="sm"><Text span fw={600}>Expertise:</Text> {i.expertise}</Text>}
                {i.background && <Text size="sm" c="dimmed">{i.background}</Text>}
                <Group gap={4}>
                  <IconMicrophone size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">{voiceLabel(voiceFor(i))}{!i.voice && ' (default)'}</Text>
                </Group>
              </Stack>
            </Group>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
