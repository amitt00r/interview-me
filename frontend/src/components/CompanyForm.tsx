import { Alert, Button, Group, Stack, TextInput, Textarea } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import type { Company, CompanyInput } from '../types';

const toInput = (c: Company | null): CompanyInput => ({
  name: c?.name ?? '',
  industry: c?.industry ?? '',
  description: c?.description ?? '',
  interviewFocus: c?.interviewFocus ?? '',
  logoUrl: c?.logoUrl ?? '',
});

export function CompanyForm({ company, onSave, onCancel }: {
  company: Company | null;
  onSave: (input: CompanyInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CompanyInput>(() => toInput(company));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof CompanyInput) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [field]: e.currentTarget.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput label="Name" required value={form.name} onChange={set('name')} placeholder="Acme Corp" />
        <TextInput label="Industry" value={form.industry ?? ''} onChange={set('industry')} placeholder="Fintech" />
        <TextInput label="Logo URL" description="Initials are shown otherwise" value={form.logoUrl ?? ''}
          onChange={set('logoUrl')} placeholder="https://…/logo.png" />
        <Textarea label="About the company" autosize minRows={3} maxRows={10} value={form.description ?? ''}
          onChange={set('description')} placeholder="What they build, size, engineering culture…" />
        <Textarea label="Interview focus" autosize minRows={4} maxRows={12} value={form.interviewFocus ?? ''}
          onChange={set('interviewFocus')}
          placeholder="Values, bar, typical rounds, e.g. 'Ownership, system design at scale, leadership principles'" />
        {error && <Alert color="red">{error}</Alert>}
        <Group>
          <Button type="submit" loading={saving}>{company ? 'Save changes' : 'Add company'}</Button>
          <Button variant="default" onClick={onCancel}>Cancel</Button>
        </Group>
      </Stack>
    </form>
  );
}
