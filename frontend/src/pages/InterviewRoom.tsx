import { ActionIcon, Alert, Anchor, Avatar, Badge, Button, Center, Group, Image, Kbd, Loader, Modal, Paper, Stack, Switch, Text, Textarea, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconChalkboard, IconClock, IconMessages, IconHourglassHigh, IconMicrophone, IconMicrophoneOff, IconPhoneOff, IconPlayerSkipForward, IconSend, IconVideo, IconVideoOff, IconVolume, IconVolumeOff } from '@tabler/icons-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

// Excalidraw is a large bundle: load it the first time the whiteboard opens.
const Whiteboard = lazy(() => import('../components/Whiteboard'));

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
  const [boardOpen, setBoardOpen] = useState(false);
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
  // Never while the whiteboard is open: drawing takes thought and silence, so the candidate submits themselves.
  const listeningHandsFree = mic === 'on' && handsFree && !busy && !!pending && !boardOpen;
  // The pause chosen when starting the interview; the countdown shows for the last 5 s (half, for short pauses).
  const pauseMs = interview.answerPauseSeconds * 1000;
  const silenceTiming = useMemo(() => ({ submitMs: pauseMs, warningMs: Math.max(pauseMs - 5000, pauseMs / 2) }),
    [pauseMs]);
  const silence = useSilenceSubmit(listeningHandsFree,
    () => answerRef.current.trim().length > 0 || boardDirtyRef.current, () => { void submit(); }, silenceTiming);
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

  const showBoard = useCallback((open: boolean) => {
    if (!open) setBoard((b) => b && { ...b, initial: sceneRef.current });
    setBoardOpen(open);
  }, []);

  // The interviewer asked for a drawing: open the board. A new main question that doesn't need one closes it.
  useEffect(() => {
    if (!pending) return;
    if (pending.whiteboardRequested) showBoard(true);
    else if (!pending.followUp) showBoard(false);
  }, [pending?.id]);

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
    if (updated.status !== 'IN_PROGRESS') clearDrafts(updated.id);
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
    if (!text && !sendBoard) return;
    stopSpeaking();
    const seconds = elapsedSeconds();
    setFrozenSeconds(seconds);
    setBusy('answer');
    setError(null);
    try {
      const drawing = sendBoard ? await snapshot(scene) : null;
      const updated = await api.interviews.answer(interview.id, text, seconds, drawing);
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

  const panel = interview.mode === 'PANEL';
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
    <div className={boardOpen ? 'room board-mode' : 'room'}>
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
          {boardOpen ? (
            <>
              <div className="stage filmstrip">
                {interview.interviewers.map((i) => <InterviewerTile key={i.id} interviewer={i} state={tileState(i)} />)}
                <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                  listening={listening} />
              </div>
              <Paper withBorder className="whiteboard">
                <div className="whiteboard-canvas">
                  <Suspense fallback={<Center h="100%"><Loader /></Center>}>
                    {board ? <Whiteboard key={board.key} initial={board.initial} onChange={onBoardChange} />
                      : <Center h="100%"><Loader /></Center>}
                  </Suspense>
                </div>
              </Paper>
            </>
          ) : panel ? (
            <div className={`stage panel-stage cols-${interview.interviewers.length + 1 === 4 ? 2 : interview.interviewers.length + 1}`}>
              {interview.interviewers.map((i) => <InterviewerTile key={i.id} interviewer={i} state={tileState(i)} />)}
              <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                listening={listening} />
            </div>
          ) : (
            <div className="stage solo-stage">
              <InterviewerTile interviewer={interview.interviewers[0]} state={tileState(interview.interviewers[0])}
                size="hero" />
              <CandidateTile name={interview.candidateName} stream={camera.stream} cameraError={camera.error}
                listening={listening} pip />
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
              <Button variant={boardOpen ? 'filled' : 'default'} onClick={() => showBoard(!boardOpen)}
                leftSection={<IconChalkboard size={18} />}
                rightSection={boardDirty && !boardOpen ? <Badge size="xs" circle>•</Badge> : undefined}>
                Whiteboard
              </Button>
            </Tooltip>
            <Tooltip label={boardOpen
              ? 'Auto-send is paused while the whiteboard is open: press Submit when you are done'
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
                  </div>
                )}
                {t.skipped && <div className="bubble candidate skipped"><p>Skipped</p></div>}
              </div>
            ))}
            {busy && (
              <div className="bubble interviewer typing">
                <Text size="sm" c="dimmed">
                  {busy === 'end' ? 'Your interviewers are writing up feedback' : 'Interviewer is thinking'}
                </Text>
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
                : boardDirty ? 'Explain your drawing, or just submit it…' : 'Type or speak your answer…'} />
            {boardDirty && (
              <Text size="xs" c="dimmed"><IconChalkboard size={12} className="inline-icon" /> Your whiteboard changes
                will be sent with this answer.</Text>
            )}
            {boardOpen && handsFree && voiceReady && (
              <Text size="xs" c="dimmed">Auto-send is paused while the whiteboard is open. Press <b>Submit</b> when
                you're done.</Text>
            )}
            {partial && <Text size="sm" c="dimmed" fs="italic">{partial}…</Text>}
            <Group justify="space-between">
              <Text size="xs" c="dimmed"><Kbd size="xs">Ctrl</Kbd> + <Kbd size="xs">Enter</Kbd></Text>
              <Group gap="xs">
                <Button onClick={submit} disabled={!!busy || !pending || (!answer.trim() && !listening && !boardDirty)}
                  loading={busy === 'answer'} leftSection={<IconSend size={16} />}>
                  Submit
                </Button>
              </Group>
            </Group>
          </Stack>
        </Paper>
      </div>

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
              type. For design questions, open the <b>Whiteboard</b> and sketch: your drawing goes to the interviewers
              with your answer. Your camera stays on this device and is never recorded.</Text>
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
