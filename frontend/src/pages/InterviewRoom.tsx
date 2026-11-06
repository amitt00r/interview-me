import { ActionIcon, Alert, Anchor, Avatar, Badge, Button, Center, Group, Image, Kbd, Loader, Modal, Paper, Stack, Switch, Text, Textarea, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconChalkboard, IconClock, IconCode, IconMessages, IconHourglassHigh, IconMicrophone, IconMicrophoneOff, IconPhoneOff, IconPlayerSkipForward, IconSend, IconVideo, IconVideoOff, IconVolume, IconVolumeOff } from '@tabler/icons-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { api, modeLabel } from '../api';
import { avatarFor } from '../avatar';
import { Clock, Clocks } from '../components/Clock';
import { confirmAction } from '../feedback';
import { hideNikolai } from '../nikolai';
import { SilenceCountdown } from '../components/SilenceCountdown';
import { useSilenceSubmit } from '../useSilenceSubmit';
import { CandidateTile, InterviewerTile, type TileState } from '../components/Tiles';
import { useCamera } from '../components/useCamera';
import { checkSpeech, listen, speak, stopSpeaking, type Listener } from '../speech';
import type { InterviewDetail, InterviewerRef } from '../types';
import { voiceFor } from '../voices';
import { setHeaderHidden } from '../chrome';
import { clearDrafts, isEmpty, loadDraft, parseScene, saveDraft, sceneVersion, snapshot, type Scene } from '../whiteboard';
import { clearCodeDrafts, convertComments, isCodeDirty, languageLabel, lastLanguage, loadCodeDraft, MAX_SOURCE_CHARS, questionComment, rememberLanguage, saveCodeDraft, starterSource, type CodeBuffer } from '../codepad';
import { CodeBlock } from '../components/CodeBlock';
import type { CodeLanguage } from '../types';

// Excalidraw is a large bundle: load it the first time the whiteboard opens. Likewise the code editor.
const Whiteboard = lazy(() => import('../components/Whiteboard'));
const CodeEditor = lazy(() => import('../components/CodeEditor'));

/** What takes the stage besides the video call: the whiteboard or the code editor (one at a time). */
type Workspace = 'none' | 'board' | 'code';

type Speech = { enabled: boolean; reason: string | null } | null;

/**
 * Video-call style room. Interviewers speak each new question through Azure TTS; the candidate can dictate
 * answers (Azure STT) or type them. The chat transcript stays alongside as the source of truth.
 */
export default function InterviewRoom({ interview, onUpdate }: {
  interview: InterviewDetail;
  onUpdate: (i: InterviewDetail) => void;
}) {
  const [joined, setJoined] = useState(false);
  const [speech, setSpeech] = useState<Speech>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [handsFree, setHandsFree] = useState(true);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [mic, setMic] = useState<'off' | 'starting' | 'on'>('off');
  const [answer, setAnswer] = useState('');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState<'answer' | 'skip' | 'end' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When the pending question appeared in the room (epoch ms), and the time pinned while it is being scored.
  const [questionSince, setQuestionSince] = useState<number | null>(null);
  const [frozenSeconds, setFrozenSeconds] = useState<number | null>(null);

  const camera = useCamera(cameraOn);
  const listenerRef = useRef<Listener | null>(null);
  const answerRef = useRef('');
  const spokenRef = useRef(new Set<number>());
  const bottomRef = useRef<HTMLDivElement>(null);

  const pending = interview.turns.find((t) => t.id === interview.pendingTurnId) ?? null;
  const voiceReady = !!speech?.enabled;

  // Whiteboard: one board per main question, carried through its follow-ups. `sceneRef` is the live drawing;
  // `board.initial` is what the editor opens with (refreshed when it closes, since closing unmounts it).
  const [workspace, setWorkspace] = useState<Workspace>('none');
  /** The person clicked to fill the stage (an interviewer's id, or the candidate), the others in a strip on top. */
  const [spotlight, setSpotlight] = useState<number | 'you' | null>(null);
  const boardOpen = workspace === 'board';
  const codeOpen = workspace === 'code';
  // The room gets the whole window: the app header is hidden while in it (restored on leaving).
  useEffect(() => {
    setHeaderHidden(true);
    return () => setHeaderHidden(false);
  }, []);
  const [board, setBoard] = useState<{ key: number; initial: Scene | null } | null>(null);
  const [boardDirty, setBoardDirty] = useState(false);
  const sceneRef = useRef<Scene | null>(null);
  const submittedVersionRef = useRef(0);
  const boardDirtyRef = useRef(false);
  const draftTimer = useRef<number | undefined>(undefined);
  const mainIndex = interview.turns.findLastIndex((t) => !t.followUp);
  const questionTurns = mainIndex < 0 ? [] : interview.turns.slice(mainIndex);
  const questionTurnId = questionTurns[0]?.id ?? null;

  // Code editor: likewise one buffer per main question, carried through its follow-ups; `codeRef` mirrors it for
  // submit and the silence clock.
  const [code, setCodeState] = useState<CodeBuffer | null>(null);
  const codeRef = useRef<CodeBuffer | null>(null);
  const codeDraftTimer = useRef<number | undefined>(undefined);
  // This question's buffer came from a draft: the candidate's own language choice stands.
  const codeDraftLoaded = useRef(false);
  const setCode = (buffer: CodeBuffer | null, save = true) => {
    codeRef.current = buffer;
    setCodeState(buffer);
    const key = questionTurnId;
    if (!save || !buffer || key === null) return;
    window.clearTimeout(codeDraftTimer.current);
    codeDraftTimer.current = window.setTimeout(() => saveCodeDraft(interview.id, key, buffer), 400);
  };
  const codeDirty = isCodeDirty(code);

  // "Question 2 · SQL: signup-to-purchase conversion · Dana Reyes": the title of the comment at the top of the code.
  const questionPosition = interview.turns.slice(0, mainIndex + 1).filter((t) => !t.followUp).length;
  const questionTitle = [`Question ${questionPosition}`, interview.questions[questionPosition - 1]?.topic,
    questionTurns[0]?.askedBy.name].filter(Boolean).join(' · ');

  // Comments follow the language, so the question stays a valid comment after switching.
  const changeLanguage = (buffer: CodeBuffer, language: CodeLanguage): CodeBuffer => ({
    language,
    source: convertComments(buffer.source, buffer.language, language),
    submittedSource: convertComments(buffer.submittedSource, buffer.language, language),
  });

  const markBoardDirty = (dirty: boolean) => {
    boardDirtyRef.current = dirty;
    setBoardDirty(dirty);
  };

  // Time a question only once the candidate is in the room and it is waiting for them.
  useEffect(() => {
    setQuestionSince(joined && pending ? Date.now() : null);
  }, [joined, pending?.id]);

  const elapsedSeconds = () => (questionSince === null ? null : Math.round((Date.now() - questionSince) / 1000));

  const updateAnswer = (text: string) => {
    answerRef.current = text;
    setAnswer(text);
  };

  // The room has its own mic and voice; Nikolai steps out while the interview runs.
  useEffect(hideNikolai, []);

  useEffect(() => {
    checkSpeech().then(setSpeech);
    return () => {
      stopSpeaking();
      listenerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [interview.turns.length, busy, partial]);

  // Hands-free: after the chosen pause, submit what was said (nothing said, nothing sent).
  // Never while the whiteboard or code editor is open: drawing and coding take thought and silence, so the
  // candidate submits themselves.
  const listeningHandsFree = mic === 'on' && handsFree && !busy && !!pending && workspace === 'none';
  // The pause chosen when starting the interview; the countdown shows for the last 5 s (half, for short pauses).
  const pauseMs = interview.answerPauseSeconds * 1000;
  const silenceTiming = useMemo(() => ({ submitMs: pauseMs, warningMs: Math.max(pauseMs - 5000, pauseMs / 2) }),
    [pauseMs]);
  const silence = useSilenceSubmit(listeningHandsFree,
    () => answerRef.current.trim().length > 0 || boardDirtyRef.current || isCodeDirty(codeRef.current),
    () => { void submit(); }, silenceTiming);
  const heard = silence.heard;

  // A new main question gets its own board: this browser's unsent draft, else the last one submitted for it.
  useEffect(() => {
    if (questionTurnId === null) return;
    let cancelled = false;
    setBoard(null);
    (async () => {
      const draft = loadDraft(interview.id, questionTurnId);
      let scene = draft?.scene ?? null;
      let submitted = draft?.submittedVersion ?? 0;
      if (!draft) {
        const last = questionTurns.findLast((t) => t.whiteboardUrl);
        const json = last ? await api.interviews.whiteboardScene(interview.id, last.id).catch(() => null) : null;
        scene = json ? parseScene(json) : null;
        submitted = sceneVersion(scene);
      }
      if (cancelled) return;
      sceneRef.current = scene;
      submittedVersionRef.current = submitted;
      markBoardDirty(!isEmpty(scene) && sceneVersion(scene) !== submitted);
      setBoard({ key: questionTurnId, initial: scene });
    })();
    return () => {
      cancelled = true;
    };
  }, [interview.id, questionTurnId]);

  // A new main question gets its own code buffer: this browser's unsent draft, else the last code submitted for it,
  // else empty in the language the question asks for (or the one used last).
  useEffect(() => {
    if (questionTurnId === null) return;
    const draft = loadCodeDraft(interview.id, questionTurnId);
    codeDraftLoaded.current = draft !== null;
    const last = questionTurns.findLast((t) => t.code)?.code;
    const language = questionTurns.findLast((t) => t.codeRequested)?.codeRequested ?? lastLanguage();
    // A fresh buffer starts with the question as a comment; it counts as unchanged until the candidate edits.
    const starter = starterSource(language, questionTitle, questionTurns[0].question);
    setCode(draft ?? (last ? { ...last, submittedSource: last.source }
      : { language, source: starter, submittedSource: starter }), false);
  }, [interview.id, questionTurnId]);

  // Opens the whiteboard or code editor in place of the video call, or goes back to the call. Closing the board
  // unmounts the editor, so its opening scene is refreshed; the code buffer lives in the room either way.
  const showWorkspace = useCallback((next: Workspace) => {
    setWorkspace((prev) => {
      if (prev === 'board' && next !== 'board') setBoard((b) => b && { ...b, initial: sceneRef.current });
      return next;
    });
  }, []);
  const toggleWorkspace = (w: Exclude<Workspace, 'none'>) => showWorkspace(workspace === w ? 'none' : w);

  // The interviewer asked for a drawing or code: open the board or the editor (in the language asked for, unless
  // code is already written). A new main question that needs neither goes back to the call.
  useEffect(() => {
    if (!pending) return;
    if (pending.whiteboardRequested) {
      showWorkspace('board');
    } else if (pending.codeRequested) {
      const requested = pending.codeRequested;
      let buffer = codeRef.current;
      // Untouched so far: switch to the language asked for.
      if (buffer && buffer.language !== requested && buffer.source === buffer.submittedSource
        && !codeDraftLoaded.current && !questionTurns.some((t) => t.code)) {
        buffer = changeLanguage(buffer, requested);
      }
      // A follow-up asking for code goes on top of the code as a comment too (once, also across reloads).
      if (buffer && pending.followUp) {
        const followUps = questionTurns.filter((t) => t.followUp);
        const block = questionComment(buffer.language,
          `Follow-up ${followUps.findIndex((t) => t.id === pending.id) + 1} · ${pending.askedBy.name}`, pending.question);
        if (!buffer.source.includes(block)) {
          const unchanged = buffer.source === buffer.submittedSource;
          const source = `${block}\n${buffer.source}`;
          // Not a change of the candidate's: unchanged code stays unchanged.
          buffer = { ...buffer, source, submittedSource: unchanged ? source : buffer.submittedSource };
        }
      }
      if (buffer && buffer !== codeRef.current) setCode(buffer);
      showWorkspace('code');
    } else if (!pending.followUp) {
      showWorkspace('none');
    }
  }, [pending?.id]);

  const onCodeChange = (source: string) => {
    const buffer = codeRef.current;
    if (!buffer) return;
    setCode({ ...buffer, source });
    heard();
  };
  const onLanguageChange = (language: CodeLanguage) => {
    const buffer = codeRef.current;
    if (!buffer) return;
    rememberLanguage(language);
    setCode(changeLanguage(buffer, language));
  };

  // Track the drawing (auto-send is off while the board is open; this keeps the silence clock fresh for when it
  // closes), and save the board as a draft.
  const onBoardChangeRef = useRef<(scene: Scene) => void>(() => {});
  onBoardChangeRef.current = (scene: Scene) => {
    sceneRef.current = scene;
    markBoardDirty(!isEmpty(scene) && sceneVersion(scene) !== submittedVersionRef.current);
    heard();
    const key = questionTurnId;
    if (key === null) return;
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(
      () => saveDraft(interview.id, key, scene, submittedVersionRef.current), 500);
  };
  const onBoardChange = useCallback((scene: Scene) => onBoardChangeRef.current(scene), []);

  const applyUpdate = (updated: InterviewDetail) => {
    if (updated.status !== 'IN_PROGRESS') {
      clearDrafts(updated.id);
      clearCodeDrafts(updated.id);
    }
    onUpdate(updated);
  };

  const stopListening = useCallback(async () => {
    const l = listenerRef.current;
    listenerRef.current = null;
    setMic('off');
    setPartial('');
    await l?.stop();
  }, []);

  const startListening = useCallback(async () => {
    if (listenerRef.current || !voiceReady) return;
    stopSpeaking();
    setSpeakingId(null);
    setMic('starting');
    setError(null);
    try {
      listenerRef.current = await listen({
        onPartial: (text) => {
          setPartial(text);
          if (text) heard();
        },
        onFinal: (text) => {
          heard();
          updateAnswer(answerRef.current ? `${answerRef.current} ${text}` : text);
        },
        onError: (msg) => {
          setError(`Microphone: ${msg}`);
          stopListening();
        },
      });
      setMic('on');
    } catch (e) {
      setMic('off');
      setError(`Microphone: ${(e as Error).message}`);
    }
  }, [voiceReady, stopListening, heard]);

  // Speak each new question once, then (hands-free) open the mic for the answer.
  const sayQuestion = useCallback(async (turnId: number, text: string, by: InterviewerRef, force = false) => {
    if (!force && spokenRef.current.has(turnId)) return;
    await stopListening();
    try {
      await speak(text, voiceFor(by), () => {
        spokenRef.current.add(turnId);
        setSpeakingId(by.id);
      });
      return true;
    } catch (e) {
      setError(`Voice: ${(e as Error).message}`);
      return false;
    } finally {
      setSpeakingId((id) => (id === by.id ? null : id));
    }
  }, [stopListening]);

  useEffect(() => {
    if (!joined || !voiceReady || !voiceOn || !pending) return;
    let cancelled = false;
    sayQuestion(pending.id, pending.question, pending.askedBy).then((finished) => {
      if (!cancelled && finished && handsFree) startListening();
    });
    return () => {
      cancelled = true;
      stopSpeaking();
    };
    // Re-run only when a new question arrives or voice availability changes.
  }, [joined, voiceReady, voiceOn, pending?.id]);

  const replay = () => {
    if (pending) sayQuestion(pending.id, pending.question, pending.askedBy, true);
  };

  const toggleVoice = () => {
    if (voiceOn) {
      stopSpeaking();
      setSpeakingId(null);
    }
    setVoiceOn(!voiceOn);
  };

  const submit = async () => {
    if (busy) return;
    await stopListening();
    const text = answerRef.current.trim();
    // The board goes with the answer when it has changed since it was last sent.
    const scene = sceneRef.current;
    const version = sceneVersion(scene);
    const sendBoard = scene !== null && !isEmpty(scene) && version !== submittedVersionRef.current;
    // Likewise the code.
    const buffer = codeRef.current;
    const sendCode = isCodeDirty(buffer);
    if (!text && !sendBoard && !sendCode) return;
    if (sendCode && buffer!.source.length > MAX_SOURCE_CHARS) {
      setError(`Your code is too long to send (at most ${MAX_SOURCE_CHARS.toLocaleString()} characters).`);
      return;
    }
    stopSpeaking();
    const seconds = elapsedSeconds();
    setFrozenSeconds(seconds);
    setBusy('answer');
    setError(null);
    try {
      const drawing = sendBoard ? await snapshot(scene) : null;
      const sentCode = sendCode ? { language: buffer!.language, source: buffer!.source } : null;
      const updated = await api.interviews.answer(interview.id, text, seconds, drawing, sentCode);
      if (sentCode) {
        // Edits made while it was being scored stay unsent.
        const now = codeRef.current ?? buffer!;
        setCode({ ...now, submittedSource: sentCode.source });
      }
      if (sendBoard) {
        submittedVersionRef.current = version;
        markBoardDirty(sceneVersion(sceneRef.current) !== version);
        if (questionTurnId !== null && sceneRef.current) {
          saveDraft(interview.id, questionTurnId, sceneRef.current, version);
        }
      }
      applyUpdate(updated);
      updateAnswer('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setFrozenSeconds(null);
    }
  };

  const skip = async () => {
    if (busy || !pending) return;
    await stopListening();
    stopSpeaking();
    const seconds = elapsedSeconds();
    setFrozenSeconds(seconds);
    setBusy('skip');
    setError(null);
    try {
      applyUpdate(await api.interviews.skip(interview.id, seconds));
      updateAnswer('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setFrozenSeconds(null);
    }
  };

  const end = async () => {
    if (!await confirmAction({ title: 'End the interview now?', message: 'Your answers so far will be scored.',
      confirmLabel: 'End interview', danger: true })) return;
    await stopListening();
    stopSpeaking();
    setBusy('end');
    setError(null);
    try {
      applyUpdate(await api.interviews.end(interview.id));
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
  };

  const tileState = (i: InterviewerRef): TileState => {
    if (speakingId === i.id) return 'speaking';
    if ((busy === 'answer' || busy === 'skip') && interview.turns.at(-1)?.askedBy.id === i.id) return 'thinking';
    if (!busy && pending?.askedBy.id === i.id) return 'asking';
    return 'idle';
  };

  const spotlitInterviewer = interview.interviewers.find((i) => i.id === spotlight);
  // Progress through the plan: the question being discussed (a follow-up belongs to it too).
  const current = interview.questions.find((q) => q.status === 'CURRENT')
    ?? interview.questions.filter((q) => q.status !== 'NOT_ATTEMPTED').at(-1);
  const listening = mic === 'on';

  // The timers, in the header over the chat (Skip sits at the right edge of the people's column).
  const clocks = joined && (
    <Clocks>
      <Clock label="This question" icon={<IconHourglassHigh size={16} />} since={questionSince}
        frozen={frozenSeconds} />
      <Clock label="Interview" icon={<IconClock size={16} />} since={questionSince}
        base={interview.answeringSeconds} frozen={frozenSeconds}
        title="Your total time on questions so far" />
    </Clocks>
  );

  return (
    <div className={workspace !== 'none' ? 'room workspace-mode' : 'room'}>
      {/* Same columns as the body: title and Skip over the people, timers over the chat. */}
      <div className="room-header">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <div>
            <Title order={3}>{interview.companyName} · {modeLabel(interview.mode)} interview</Title>
            {/* One subheading line, the same with or without the whiteboard: the question, then who and which round. */}
            <Text size="sm" lineClamp={1}>
              {current && (
                <Text span fw={600} c="var(--mantine-primary-color-filled)">
                  Question {current.position} of {interview.questions.length}{current.topic && ` · ${current.topic}`}
                </Text>
              )}
              <Text span c="dimmed">
                {current && ' · '}
                {interview.candidateName}{interview.targetRole && ` — ${interview.targetRole}`}
                {interview.roundName && ` · ${interview.roundName}`}
                {interview.attempt > 1 && ` · Attempt ${interview.attempt}`}
              </Text>
            </Text>
          </div>
          <Group gap="sm" wrap="nowrap">
            {speech && !speech.enabled && (
              <Tooltip label={speech.reason ?? ''}><Badge color="gray" variant="outline">Text-only mode</Badge></Tooltip>
            )}
            <Tooltip label="Skip this question. It scores 0, and you can retry it later with Re-attempt.">
              <Button variant="default" className="room-control" onClick={skip} disabled={!!busy || !pending}
                loading={busy === 'skip'} leftSection={<IconPlayerSkipForward size={16} />}>
                Skip Question
              </Button>
            </Tooltip>
          </Group>
        </Group>
        {/* As wide as the chat below it. */}
        {clocks}
      </div>

      <div className="room-body">
        <div className="stage-col">
          {workspace !== 'none' ? (
            <>
              <div className="stage filmstrip">
                {interview.interviewers.map((i) => <InterviewerTile key={i.id} interviewer={i} state={tileState(i)} compact />)}
                <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                  listening={listening} />
              </div>
              <Paper withBorder className="whiteboard">
                <div className="whiteboard-canvas">
                  <Suspense fallback={<Center h="100%"><Loader /></Center>}>
                    {boardOpen && (board ? <Whiteboard key={board.key} initial={board.initial} onChange={onBoardChange} />
                      : <Center h="100%"><Loader /></Center>)}
                    {codeOpen && code && (
                      <CodeEditor key={questionTurnId ?? 0} language={code.language} source={code.source}
                        onLanguageChange={onLanguageChange} onSourceChange={onCodeChange} onSubmit={() => { void submit(); }} />
                    )}
                  </Suspense>
                </div>
              </Paper>
            </>
          ) : (
            // Everyone in equal tiles, you last. Clicking a tile spotlights that person: big, with the others in a
            // small strip on top; clicking the big tile goes back to everyone.
            <div className="stage people-stage">
              {spotlight !== null ? (
                <>
                  <div className="spotlight-strip">
                    {interview.interviewers.filter((i) => i.id !== spotlight).map((i) => (
                      <InterviewerTile key={i.id} interviewer={i} state={tileState(i)} compact
                        onClick={() => setSpotlight(i.id)} />
                    ))}
                    {spotlight !== 'you' && (
                      <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                        listening={listening} compact onClick={() => setSpotlight('you')} />
                    )}
                  </div>
                  {spotlitInterviewer ? (
                    <InterviewerTile interviewer={spotlitInterviewer} state={tileState(spotlitInterviewer)} size="hero"
                      onClick={() => setSpotlight(null)} actionLabel="Show everyone" />
                  ) : (
                    <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                      listening={listening} size="hero" onClick={() => setSpotlight(null)} actionLabel="Show everyone" />
                  )}
                </>
              ) : (
                <div className="people-fit">
                  <div className="people-grid" style={gridShape(interview.interviewers.length + 1)}>
                    {interview.interviewers.map((i) => (
                      <InterviewerTile key={i.id} interviewer={i} state={tileState(i)} onClick={() => setSpotlight(i.id)} />
                    ))}
                    <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                      listening={listening} onClick={() => setSpotlight('you')} />
                  </div>
                </div>
              )}
            </div>
          )}

          <Group justify="center" gap="sm" wrap="wrap">
            <Tooltip label={voiceReady ? (listening ? 'Stop dictation' : 'Answer by voice') : speech?.reason ?? ''}>
              <Button color={listening ? 'teal' : undefined} variant={listening ? 'filled' : 'default'}
                onClick={listening ? stopListening : startListening} loading={mic === 'starting'}
                disabled={!voiceReady || !!busy || !pending}
                leftSection={listening ? <IconMicrophone size={18} /> : <IconMicrophoneOff size={18} />}>
                {listening ? 'Listening' : 'Speak'}
              </Button>
            </Tooltip>
            <Button variant="default" c={cameraOn ? undefined : 'red'} onClick={() => setCameraOn(!cameraOn)}
              leftSection={cameraOn ? <IconVideo size={18} /> : <IconVideoOff size={18} />}>
              Camera
            </Button>
            <Button variant="default" c={voiceOn ? undefined : 'red'} onClick={toggleVoice} disabled={!voiceReady}
              leftSection={voiceOn ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}>
              Voice
            </Button>
            <Tooltip label={boardOpen ? 'Back to the video call (your drawing is kept)'
              : 'Sketch your answer. The drawing is sent with your next answer.'}>
              <Button variant={boardOpen ? 'filled' : 'default'} onClick={() => toggleWorkspace('board')}
                leftSection={<IconChalkboard size={18} />}
                rightSection={boardDirty && !boardOpen ? <Badge size="xs" circle>•</Badge> : undefined}>
                Whiteboard
              </Button>
            </Tooltip>
            <Tooltip label={codeOpen ? 'Back to the video call (your code is kept)'
              : 'Write Java, Python or SQL. The code is sent with your next answer.'}>
              <Button variant={codeOpen ? 'filled' : 'default'} onClick={() => toggleWorkspace('code')}
                leftSection={<IconCode size={18} />}
                rightSection={codeDirty && !codeOpen ? <Badge size="xs" circle>•</Badge> : undefined}>
                Code
              </Button>
            </Tooltip>
            <Tooltip label={workspace !== 'none'
              ? `Auto-send is paused while the ${boardOpen ? 'whiteboard' : 'code editor'} is open: press Submit when you are done`
              : `Open the mic after each question, and submit after ${interview.answerPauseSeconds} seconds of silence`}>
              <Paper withBorder px="md" py={7}>
                <Switch size="sm" label="Hands-free" checked={handsFree} disabled={!voiceReady}
                  onChange={(e) => setHandsFree(e.currentTarget.checked)} />
              </Paper>
            </Tooltip>
            <Button color="red" onClick={end} disabled={!!busy} loading={busy === 'end'}
              leftSection={<IconPhoneOff size={18} />}>
              End
            </Button>
          </Group>
        </div>

        <Paper withBorder className="chat">
          <Group justify="space-between" px="sm" py="xs" className="chat-header" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <ThemeIcon variant="light" radius="xl"><IconMessages size={16} /></ThemeIcon>
              <Text fw={600} size="sm">Interview chat</Text>
            </Group>
            <Text size="xs" c="dimmed">
              {interview.turns.length} {interview.turns.length === 1 ? 'question' : 'questions'} asked
            </Text>
          </Group>
          <div className="chat-log">
            {interview.turns.map((t) => (
              <div key={t.id}>
                <div className="msg from-interviewer">
                  <Avatar src={avatarFor(t.askedBy)} size={30} radius="xl" />
                  <div className="bubble interviewer">
                    <Group gap="xs" mb={4}>
                      <Text fw={600} size="sm">{t.askedBy.name}</Text>
                      {t.followUp && <Badge size="xs" variant="light">Follow-up</Badge>}
                      {t.whiteboardRequested && (
                        <Badge size="xs" variant="light" color="grape" leftSection={<IconChalkboard size={10} />}>
                          Whiteboard
                        </Badge>
                      )}
                      {t.codeRequested && (
                        <Badge size="xs" variant="light" color="teal" leftSection={<IconCode size={10} />}>
                          {languageLabel(t.codeRequested)}
                        </Badge>
                      )}
                      {/* Replay: on the question waiting for an answer (the last message), when voice is on. */}
                      {t.id === pending?.id && voiceReady && (
                        <Tooltip label={voiceOn ? 'Replay the question' : 'Turn Voice on to replay'}>
                          <ActionIcon variant="subtle" size="sm" ml="auto" aria-label="Replay the question"
                            onClick={replay} disabled={!voiceOn || !!busy}>
                            <IconVolume size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                    <p>{t.question}</p>
                  </div>
                </div>
                {t.answer && (
                  <div className="bubble candidate">
                    <p>{t.answer}</p>
                    {t.whiteboardUrl && (
                      <Anchor href={t.whiteboardUrl} target="_blank" rel="noreferrer">
                        <Image src={t.whiteboardUrl} alt="Your whiteboard" mt={6} className="board-thumb" />
                      </Anchor>
                    )}
                    {t.code && <CodeBlock code={t.code} mt={6} compact />}
                  </div>
                )}
                {t.skipped && <div className="bubble candidate skipped"><p>Skipped</p></div>}
              </div>
            ))}
            {busy && busy !== 'end' && (
              <div className="bubble interviewer typing">
                <Text size="sm" c="dimmed">Interviewer is thinking</Text>
                <span className="dots"><i /><i /><i /></span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <Stack gap="xs" p="sm" className="composer">
            {error && <Alert color="red" p="xs">{error}</Alert>}
            <SilenceCountdown remainingMs={silence.remainingMs} timing={silenceTiming} />
            <Textarea autosize minRows={3} maxRows={8} value={answer} onChange={(e) => updateAnswer(e.currentTarget.value)}
              onKeyDown={onKeyDown} disabled={!!busy || !pending}
              placeholder={listening ? 'Listening… your words appear here'
                : boardDirty ? 'Explain your drawing, or just submit it…'
                  : codeDirty ? 'Explain your code, or just submit it…' : 'Type or speak your answer…'} />
            {boardDirty && (
              <Text size="xs" c="dimmed"><IconChalkboard size={12} className="inline-icon" /> Your whiteboard changes
                will be sent with this answer.</Text>
            )}
            {codeDirty && (
              <Text size="xs" c="dimmed"><IconCode size={12} className="inline-icon" /> Your code changes will be sent
                with this answer.</Text>
            )}
            {workspace !== 'none' && handsFree && voiceReady && (
              <Text size="xs" c="dimmed">Auto-send is paused while the {boardOpen ? 'whiteboard' : 'code editor'} is
                open. Press <b>Submit</b> when you're done.</Text>
            )}
            {partial && <Text size="sm" c="dimmed" fs="italic">{partial}…</Text>}
            <Group justify="space-between">
              <Text size="xs" c="dimmed"><Kbd size="xs">Ctrl</Kbd> + <Kbd size="xs">Enter</Kbd></Text>
              <Group gap="xs">
                <Button onClick={submit} disabled={!!busy || !pending || (!answer.trim() && !listening && !boardDirty && !codeDirty)}
                  loading={busy === 'answer'} leftSection={<IconSend size={16} />}>
                  Submit
                </Button>
              </Group>
            </Group>
          </Stack>
        </Paper>
      </div>

      {/* Ending: the final evaluation takes a while, so say so over the whole room until the report opens. */}
      <Modal opened={busy === 'end'} onClose={() => {}} withCloseButton={false} closeOnClickOutside={false}
        closeOnEscape={false} centered size="sm" padding="xl">
        <Stack align="center" gap="md" ta="center">
          <Loader size="lg" />
          <div>
            <Title order={3}>Your interviewers are writing up feedback</Title>
            <Text c="dimmed" size="sm" mt={4}>This can take a minute. Your report opens as soon as it's ready.</Text>
          </div>
        </Stack>
      </Modal>

      <Modal opened={!joined} onClose={() => {}} withCloseButton={false} closeOnClickOutside={false}
        closeOnEscape={false} centered size="lg" padding="xl">
        <Stack gap="md">
          <div>
            <Title order={2}>Ready to join?</Title>
            <Text c="dimmed">
              {interview.companyName} · {modeLabel(interview.mode)} with{' '}
              {interview.interviewers.map((i) => i.name).join(', ')}
            </Text>
          </div>
          <div className="lobby-preview">
            <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
              listening={false} />
            <Stack gap="sm" justify="center">
              {interview.interviewers.map((i) => (
                <Group key={i.id} gap="sm" wrap="nowrap">
                  <Avatar src={avatarFor(i)} size={40} radius="xl" />
                  <div><Text fw={600} size="sm">{i.name}</Text><Text size="xs" c="dimmed">{i.title}</Text></div>
                </Group>
              ))}
            </Stack>
          </div>
          {speech === null && <Text size="sm" c="dimmed">Checking voice service…</Text>}
          {speech?.enabled && (
            <Text size="sm">Interviewers will speak their questions. Use <b>Speak</b> to answer by voice, or just
              type. For design questions, open the <b>Whiteboard</b> and sketch; for coding questions, open <b>Code</b>{' '}
              and write Java, Python or SQL: your drawing or code goes to the interviewers with your answer. Your camera stays on this device and is never recorded.</Text>
          )}
          {speech && !speech.enabled && <Alert color="yellow">{speech.reason} You can still type answers.</Alert>}
          <Group>
            <Button size="md" onClick={() => setJoined(true)} disabled={speech === null}>Join interview</Button>
            <Button size="md" variant="default" onClick={() => setCameraOn(!cameraOn)}
              leftSection={cameraOn ? <IconVideoOff size={18} /> : <IconVideo size={18} />}>
              {cameraOn ? 'Turn camera off' : 'Turn camera on'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

/** The people grid: at most 2 tiles in a row, each row half the stage height (smaller with more than 2 rows). */
function gridShape(count: number): CSSProperties {
  return { '--cols': Math.min(count, 2), '--rows': Math.max(2, Math.ceil(count / 2)) } as CSSProperties;
}
