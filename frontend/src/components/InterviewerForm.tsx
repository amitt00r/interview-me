import { Alert, Avatar, Button, FileButton, Group, NumberInput, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop, IconTrash, IconUpload } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { avatarFor } from '../avatar';
import { checkSpeech, speak, stopSpeaking } from '../speech';
import type { Interviewer, InterviewerInput } from '../types';
import { useAsync } from '../useAsync';
import { VOICES, voiceFor, voiceLabel } from '../voices';

const toInput = (i: Interviewer | null, companyId: number): InterviewerInput => ({
  name: i?.name ?? '',
  title: i?.title ?? '',
  yearsOfExperience: i?.yearsOfExperience ?? 5,
  expertise: i?.expertise ?? '',
  background: i?.background ?? '',
  voice: i?.voice ?? '',
  companyId,
});

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** What to do with the photo after the interviewer is saved: upload a new file, remove the current one, or leave it. */
export type PhotoChange = { upload: File } | { remove: true } | null;

/** Add or edit one of a company's interviewers. */
export function InterviewerForm({ interviewer, companyId, onSave, onCancel }: {
  interviewer: Interviewer | null;
  companyId: number;
  onSave: (input: InterviewerInput, photo: PhotoChange) => Promise<void>;
  onCancel: () => void;
}) {
  const { data: speech } = useAsync(checkSpeech);
  const [form, setForm] = useState<InterviewerInput>(() => toInput(interviewer, companyId));
  const [photo, setPhoto] = useState<PhotoChange>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: 'name' | 'title' | 'expertise' | 'background') =>
    (e: { currentTarget: { value: string } }) => setForm({ ...form, [field]: e.currentTarget.value });

  // The default voice matches the name's likely gender; a new interviewer's exact pick depends on the id it gets.
  const formVoice = form.voice || voiceFor({ id: interviewer?.id ?? 0, name: form.name || 'Interviewer', voice: null });

  const preview = async () => {
    if (previewing) {
      stopSpeaking();
      return;
    }
    setPreviewing(true);
    try {
      const intro = `Hi, I'm ${form.name || 'your interviewer'}${form.title ? `, ${form.title}` : ''}. Let's get started.`;
      await speak(intro, formVoice);
    } catch (err) {
      setError(`Voice preview failed: ${(err as Error).message}`);
    } finally {
      setPreviewing(false);
    }
  };

  // Show a chosen file straight away, before it is uploaded.
  useEffect(() => {
    if (!photo || !('upload' in photo)) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo.upload);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const shownPhoto = photoPreview
    ?? avatarFor({ name: form.name || 'New interviewer', photoUrl: photo ? null : interviewer?.photoUrl });
  const hasPhoto = photo ? 'upload' in photo : !!interviewer?.photoUrl;

  const choosePhoto = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (JPEG, PNG, WebP or GIF).');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('Photo must be 5 MB or smaller.');
      return;
    }
    setError(null);
    setPhoto({ upload: file });
  };

  const removePhoto = () => setPhoto(interviewer?.photoUrl ? { remove: true } : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    stopSpeaking();
    setSaving(true);
    setError(null);
    try {
      await onSave(form, photo);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <Group align="center" gap="lg">
          <Avatar src={shownPhoto} size={96} radius={96} />
          <Stack gap={6}>
            <Title order={4}>{interviewer ? `Edit ${interviewer.name}` : 'Add an interviewer'}</Title>
            <Group gap="xs">
              <FileButton onChange={choosePhoto} accept="image/jpeg,image/png,image/webp,image/gif">
                {(props) => (
                  <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />}>
                    {hasPhoto ? 'Change photo' : 'Upload photo'}
                  </Button>
                )}
              </FileButton>
              {hasPhoto && (
                <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={removePhoto}>
                  Remove
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed">JPEG, PNG, WebP or GIF, up to 5 MB. Without one, an illustrated avatar is used.</Text>
          </Stack>
        </Group>
        <TextInput label="Name" required value={form.name} onChange={set('name')} placeholder="Priya Sharma" />
        <Group grow align="flex-start">
          <TextInput label="Title" value={form.title} onChange={set('title')} placeholder="Staff Backend Engineer" />
          <NumberInput label="Years of experience" min={0} max={60} value={form.yearsOfExperience} maw={200}
            onChange={(v) => setForm({ ...form, yearsOfExperience: Number(v) || 0 })} />
        </Group>
        <TextInput label="Expertise" value={form.expertise} onChange={set('expertise')}
          placeholder="Distributed systems, Java, system design" />
        <Textarea label="Background & interviewing style" autosize minRows={3} maxRows={8} value={form.background}
          onChange={set('background')}
          placeholder="Ex-payments infra lead. Friendly but digs hard into trade-offs and failure modes." />
        <Group align="flex-end">
          <Select label="Voice" style={{ flex: 1 }} value={form.voice} allowDeselect={false}
            onChange={(v) => setForm({ ...form, voice: v ?? '' })}
            data={[
              { value: '', label: interviewer ? `Default (${voiceLabel(formVoice)})` : 'Default (assigned when saved)' },
              ...VOICES.map((v) => ({ value: v.id, label: v.label })),
            ]} />
          <Button variant="default" onClick={preview} disabled={!speech?.enabled}
            title={speech?.enabled ? 'Hear this voice' : speech?.reason ?? ''}
            leftSection={previewing ? <IconPlayerStop size={16} /> : <IconPlayerPlay size={16} />}>
            {previewing ? 'Stop' : 'Preview'}
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        <Group>
          <Button type="submit" loading={saving}>{interviewer ? 'Save changes' : 'Add interviewer'}</Button>
          <Button variant="default" onClick={onCancel}>Cancel</Button>
        </Group>
      </Stack>
    </form>
  );
}
