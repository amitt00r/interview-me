import type {
  Company,
  CompanyInput,
  AttemptSummary,
  InterviewDetail,
  InterviewMode,
  InterviewStatus,
  InterviewSummary,
  Interviewer,
  InterviewerInput,
  NikolaiReply,
  StudyGuide,
  TopicCatalog,
} from './types';
import type { WhiteboardSnapshot } from './whiteboard';

/** Error carrying the backend's ProblemDetail `detail` message, and per-field `errors` when it sends them. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors: Record<string, string> = {}) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let errors: Record<string, string> = {};
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
      errors = body.errors ?? {};
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(message, res.status, errors);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  companies: {
    list: () => request<Company[]>('/companies'),
    get: (id: number) => request<Company>(`/companies/${id}`),
    create: (c: CompanyInput) => request<Company>('/companies', json('POST', c)),
    update: (id: number, c: CompanyInput) => request<Company>(`/companies/${id}`, json('PUT', c)),
    remove: (id: number) => request<void>(`/companies/${id}`, { method: 'DELETE' }),
  },
  interviewers: {
    list: (companyId: number) => request<Interviewer[]>(`/interviewers?companyId=${companyId}`),
    create: (i: InterviewerInput) => request<Interviewer>('/interviewers', json('POST', i)),
    update: (id: number, i: InterviewerInput) => request<Interviewer>(`/interviewers/${id}`, json('PUT', i)),
    remove: (id: number) => request<void>(`/interviewers/${id}`, { method: 'DELETE' }),
    uploadPhoto: (id: number, photo: File) => {
      const form = new FormData();
      form.append('photo', photo);
      return request<Interviewer>(`/interviewers/${id}/photo`, { method: 'POST', body: form });
    },
    removePhoto: (id: number) => request<Interviewer>(`/interviewers/${id}/photo`, { method: 'DELETE' }),
  },
  topics: {
    catalog: () => request<TopicCatalog>('/topics'),
  },
  nikolai: {
    /** One chat message, optionally with a resume for starting interviews. */
    chat: (conversationId: string | null, message: string, resume: File | null) => {
      const form = new FormData();
      if (conversationId) form.append('conversationId', conversationId);
      form.append('message', message);
      if (resume) form.append('resume', resume);
      return request<NikolaiReply>('/nikolai/chat', { method: 'POST', body: form });
    },
    /** Ends a conversation on the server (the chat's "New chat"). */
    forget: (conversationId: string) =>
      request<void>(`/nikolai/chat/${encodeURIComponent(conversationId)}`, { method: 'DELETE' }),
  },
  interviews: {
    list: (statuses: InterviewStatus[]) =>
      request<InterviewSummary[]>(`/interviews?status=${statuses.join(',')}`),
    get: (id: number) => request<InterviewDetail>(`/interviews/${id}`),
    start: (input: {
      candidateName: string;
      targetRole: string;
      jobDescription: string;
      companyId: number;
      mode: InterviewMode;
      roundName: string;
      roundDescription: string;
      answerPauseSeconds: number;
      topics: string[];
      resume: File;
    }) => {
      const form = new FormData();
      form.append('candidateName', input.candidateName);
      form.append('targetRole', input.targetRole);
      form.append('jobDescription', input.jobDescription);
      form.append('companyId', String(input.companyId));
      form.append('mode', input.mode);
      form.append('roundName', input.roundName);
      form.append('roundDescription', input.roundDescription);
      form.append('answerPauseSeconds', String(input.answerPauseSeconds));
      // One part per topic, in priority order.
      input.topics.forEach((t) => form.append('topics', t));
      form.append('resume', input.resume);
      return request<InterviewDetail>('/interviews', { method: 'POST', body: form });
    },
    /** `whiteboard` is the board at submit time, or null when it wasn't used (or hasn't changed since last sent). */
    answer: (id: number, answer: string, responseSeconds: number | null, whiteboard: WhiteboardSnapshot | null = null) =>
      request<InterviewDetail>(`/interviews/${id}/answers`, json('POST', { answer, responseSeconds, whiteboard })),
    /** The Excalidraw scene submitted with a turn's answer, to reopen the board after a reload. */
    whiteboardScene: (id: number, turnId: number) =>
      fetch(`/api/interviews/${id}/turns/${turnId}/whiteboard/scene`).then((r) => (r.ok ? r.text() : null)),
    reattempt: (id: number) => request<InterviewDetail>(`/interviews/${id}/reattempt`, { method: 'POST' }),
    attempts: (id: number) => request<AttemptSummary[]>(`/interviews/${id}/attempts`),
    skip: (id: number, responseSeconds: number | null) =>
      request<InterviewDetail>(`/interviews/${id}/skip`, json('POST', { responseSeconds })),
    studyGuide: (id: number, questionId: number) =>
      request<StudyGuide>(`/interviews/${id}/questions/${questionId}/study-guide`, { method: 'POST' }),
    followUpStudyGuide: (id: number, turnId: number) =>
      request<StudyGuide>(`/interviews/${id}/turns/${turnId}/study-guide`, { method: 'POST' }),
    end: (id: number) => request<InterviewDetail>(`/interviews/${id}/end`, { method: 'POST' }),
    remove: (id: number) => request<void>(`/interviews/${id}`, { method: 'DELETE' }),
    resumeUrl: (id: number) => `/api/interviews/${id}/resume`,
  },
};

export const modeLabel = (m: InterviewMode) => (m === 'PANEL' ? 'Panel' : 'One-on-one');

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** 75 → "1:15", 3725 → "1:02:05". */
export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** 75 → "1m 15s", 3725 → "1h 2m", 40 → "40s". */
export const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Colour band for a score out of `max`. */
export const scoreBand = (score: number | null, max: number) => {
  if (score === null) return '';
  const pct = score / max;
  return pct >= 0.7 ? 'good' : pct >= 0.5 ? 'ok' : 'low';
};

/** Mantine colour for a score out of `max`: teal ≥ 70%, orange ≥ 50%, red below, gray when there is no score. */
export const scoreColor = (score: number | null, max: number) => {
  const band = scoreBand(score, max);
  return band === 'good' ? 'teal' : band === 'ok' ? 'orange' : band === 'low' ? 'red' : 'gray';
};
