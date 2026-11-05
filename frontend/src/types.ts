// Mirrors the backend DTOs in com.mockinterviewer.*.*Dtos.

export type InterviewMode = 'ONE_ON_ONE' | 'PANEL';
export type InterviewStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export interface Company {
  id: number;
  name: string;
  industry: string | null;
  description: string | null;
  interviewFocus: string | null;
  logoUrl: string | null;
  interviewerCount: number;
}

export type CompanyInput = Omit<Company, 'id' | 'interviewerCount'>;

export interface Interviewer {
  id: number;
  name: string;
  title: string | null;
  yearsOfExperience: number;
  expertise: string | null;
  background: string | null;
  voice: string | null;
  photoUrl: string | null;
  companyId: number;
  companyName: string;
}

export interface InterviewerInput {
  name: string;
  title: string;
  yearsOfExperience: number;
  expertise: string;
  background: string;
  voice: string;
  companyId: number;
}

export interface InterviewerRef {
  id: number;
  name: string;
  title: string | null;
  voice: string | null;
  photoUrl: string | null;
}

/** Languages the room's code editor supports. */
export type CodeLanguage = 'JAVA' | 'PYTHON' | 'SQL';

/** Code submitted with an answer. */
export interface CodeSubmission {
  language: CodeLanguage;
  source: string;
}

export interface Turn {
  id: number;
  sequence: number;
  askedBy: InterviewerRef;
  question: string;
  followUp: boolean;
  answer: string | null;
  skipped: boolean;
  score: number | null;
  feedback: string | null;
  askedAt: string;
  answeredAt: string | null;
  /** Seconds the candidate took on this question; null if not recorded. */
  responseSeconds: number | null;
  /** "Ask AI" model answer and reading list for a follow-up, once requested (null until then). */
  studyGuide: StudyGuide | null;
  /** The interviewer asked for the whiteboard on this question (the room opens it). */
  whiteboardRequested: boolean;
  /** PNG of the whiteboard submitted with the answer; null if the candidate didn't draw. */
  whiteboardUrl: string | null;
  /** The interviewer asked for code in this language (the room opens the code editor); null if not. */
  codeRequested: CodeLanguage | null;
  /** Code submitted with the answer; null if the candidate wrote none. */
  code: CodeSubmission | null;
}

/** Fields shared by the list and detail views of an interview. */
interface InterviewBase {
  id: number;
  candidateName: string;
  targetRole: string | null;
  companyId: number;
  companyName: string;
  mode: InterviewMode;
  status: InterviewStatus;
  overallScore: number | null;
  interviewers: InterviewerRef[];
  startedAt: string;
  completedAt: string | null;
  /** The original interview this reattempt replays; null for an original. */
  retakeOfId: number | null;
  attempt: number;
  /** Sum of the per-question times. */
  answeringSeconds: number;
  /** Wall-clock session length; null while in progress. */
  durationSeconds: number | null;
  /** Main questions answered; follow-ups and skips don't count. */
  attemptedQuestions: number;
  /** Main questions skipped. */
  skippedQuestions: number;
  /** Main questions the interview was set up to ask, introduction included. */
  plannedQuestions: number;
  /** Ended (completed or abandoned) with questions to replay, or itself a reattempt. */
  reattemptable: boolean;
  /** Optional name of the round being practised. */
  roundName: string | null;
  /** Topics the round is restricted to, in priority order; empty when Claude chooses the areas. */
  focusTopics: string[];
}

export interface InterviewSummary extends InterviewBase {
  companyLogoUrl: string | null;
}

export interface AttemptSummary {
  id: number;
  attempt: number;
  status: InterviewStatus;
  overallScore: number | null;
  startedAt: string;
  completedAt: string | null;
}

export type QuestionStatus = 'ANSWERED' | 'SKIPPED' | 'CURRENT' | 'NOT_ATTEMPTED';

/** A planned main question and how this attempt went on it. */
export interface QuestionResult {
  id: number;
  position: number;
  topic: string | null;
  question: string;
  askedBy: InterviewerRef;
  status: QuestionStatus;
  answer: string | null;
  score: number | null;
  feedback: string | null;
  responseSeconds: number | null;
  followUps: Turn[];
  /** "Ask AI" model answer and reading list for the main question, once requested (null until then). */
  studyGuide: StudyGuide | null;
  /** PNG of the whiteboard submitted with the main answer; null if the candidate didn't draw. */
  whiteboardUrl: string | null;
  /** The question is answered in the code editor, in this language; null if not. */
  codeLanguage: CodeLanguage | null;
  /** Code submitted with the main answer; null if the candidate wrote none. */
  code: CodeSubmission | null;
}

export interface StudyTopic {
  topic: string;
  reason: string;
}

/** "Ask AI" coaching for a main question or follow-up of an ended interview. */
export interface StudyGuide {
  modelAnswer: string;
  studyTopics: StudyTopic[];
}

/**
 * How one focus topic went in this attempt. `minScore` / `maxScore` / `lastScore` (0-10) cover every resolved turn
 * on the topic, follow-ups included and skips as 0 (last = most recent); null until something on it is answered or
 * skipped.
 */
export interface TopicResult {
  topic: string;
  questions: number;
  answered: number;
  skipped: number;
  minScore: number | null;
  maxScore: number | null;
  lastScore: number | null;
}

export interface TopicCategory {
  name: string;
  topics: string[];
}

/** GET /api/topics: suggestions for focus topics, plus the limits the backend enforces. */
export interface TopicCatalog {
  maxTopics: number;
  maxTopicChars: number;
  categories: TopicCategory[];
  /** Shorthand (as a matching key, e.g. "dsa") to its catalog topic. */
  aliases: Record<string, string>;
}

export interface InterviewDetail extends InterviewBase {
  /** Every planned question, in order, with this attempt's status. */
  questions: QuestionResult[];
  jobDescription: string | null;
  turns: Turn[];
  pendingTurnId: number | null;
  resumeFileName: string | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  roundDescription: string | null;
  /** One entry per focus topic, in the round's order. */
  topicResults: TopicResult[];
  /** Hands-free answering: seconds of silence before the room submits the answer. */
  answerPauseSeconds: number;
}

/** A link Nikolai offers under a reply, e.g. to a company he just added. */
export interface NikolaiLink {
  label: string;
  to: string;
}

/** Nikolai's reply to one chat message (backend NikolaiService.ChatReply). */
export interface NikolaiReply {
  conversationId: string;
  reply: string;
  links: NikolaiLink[];
  /** Set when he started an interview: the app opens its room. */
  navigateTo: string | null;
  toolsUsed: string[];
}
