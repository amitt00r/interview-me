import type { CodeLanguage } from './types';

/**
 * The interview room's code editor data, kept apart from the CodeMirror component (like `whiteboard.ts`) so the room
 * can track drafts without loading the editor. One buffer per main question, carried through its follow-ups.
 */
export interface CodeBuffer {
  language: CodeLanguage;
  source: string;
  /** The source as last sent with an answer ('' if never sent): unchanged code isn't sent again. */
  submittedSource: string;
}

export const CODE_LANGUAGES: { value: CodeLanguage; label: string }[] = [
  { value: 'JAVA', label: 'Java' },
  { value: 'PYTHON', label: 'Python' },
  { value: 'SQL', label: 'SQL' },
];

export const languageLabel = (language: CodeLanguage) =>
  CODE_LANGUAGES.find((l) => l.value === language)?.label ?? language;

/** Matches the backend's `TurnCode.MAX_SOURCE_CHARS`. */
export const MAX_SOURCE_CHARS = 50_000;

export const isCodeEmpty = (buffer: CodeBuffer | null) => !buffer || buffer.source.trim() === '';

/** Has code that hasn't been sent yet. */
export const isCodeDirty = (buffer: CodeBuffer | null) =>
  !!buffer && !isCodeEmpty(buffer) && buffer.source !== buffer.submittedSource;

const LAST_LANGUAGE_KEY = 'code:language';

/** The language the candidate picked last, for questions that don't name one. */
export function lastLanguage(): CodeLanguage {
  const raw = localStorage.getItem(LAST_LANGUAGE_KEY);
  return CODE_LANGUAGES.some((l) => l.value === raw) ? (raw as CodeLanguage) : 'JAVA';
}

export function rememberLanguage(language: CodeLanguage) {
  localStorage.setItem(LAST_LANGUAGE_KEY, language);
}

const draftKey = (interviewId: number, questionTurnId: number) => `code:${interviewId}:${questionTurnId}`;

export function loadCodeDraft(interviewId: number, questionTurnId: number): CodeBuffer | null {
  try {
    const raw = localStorage.getItem(draftKey(interviewId, questionTurnId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<CodeBuffer>;
    if (!CODE_LANGUAGES.some((l) => l.value === draft.language) || typeof draft.source !== 'string') return null;
    return { language: draft.language!, source: draft.source, submittedSource: draft.submittedSource ?? '' };
  } catch {
    return null;
  }
}

export function saveCodeDraft(interviewId: number, questionTurnId: number, buffer: CodeBuffer) {
  try {
    localStorage.setItem(draftKey(interviewId, questionTurnId), JSON.stringify(buffer));
  } catch {
    // Storage full or unavailable: the draft just isn't kept across reloads.
  }
}

export function clearCodeDrafts(interviewId: number) {
  const prefix = `code:${interviewId}:`;
  Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k));
}

/** Line-comment marker per language. */
const COMMENT: Record<CodeLanguage, string> = { JAVA: '//', PYTHON: '#', SQL: '--' };

/** Wraps prose into lines of at most `width` characters (long words stay whole). */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * A comment block with a title line and the question wrapped to about 80 columns, in the language's comment syntax,
 * so the candidate can read the question right where they code.
 */
export function questionComment(language: CodeLanguage, title: string, question: string): string {
  const c = COMMENT[language];
  return [`${c} ${title}`, `${c}`, ...wrap(question, 80).map((l) => `${c} ${l}`)].join('\n') + '\n';
}

/** What a new buffer starts with: the question comment, then a blank line to write in. */
export const starterSource = (language: CodeLanguage, title: string, question: string) =>
  `${questionComment(language, title, question)}\n`;

/**
 * Rewrites whole-line comments from one language's syntax to another's (the question comments and the candidate's
 * own), so switching language keeps them valid comments.
 */
export function convertComments(source: string, from: CodeLanguage, to: CodeLanguage): string {
  if (from === to) return source;
  const marker = COMMENT[from].replace(/[/]/g, '\\/');
  return source.replace(new RegExp(`^(\\s*)${marker}`, 'gm'), `$1${COMMENT[to]}`);
}
