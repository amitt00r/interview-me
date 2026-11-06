import { ActionIcon, Affix, Avatar, Badge, Button, CloseButton, FileButton, Group, Loader, Paper, ScrollArea, Stack, Text, Textarea, Tooltip, Transition } from '@mantine/core';
import { IconMessagePlus, IconMicrophone, IconMicrophoneOff, IconPaperclip, IconHeadset, IconHeadsetOff, IconSend, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { nikolaiAvatar } from '../avatar';
import { NIKOLAI, nikolaiGreeting, useNikolaiHidden, useNikolaiVoice } from '../nikolai';
import { cancelListening, checkSpeech, listen, ListenCancelled, speak, stopSpeaking, type Listener } from '../speech';
import type { NikolaiLink } from '../types';
import { DATA_CHANGED } from '../useAsync';
import { CHAT_PAUSE, usePref } from '../preferences';
import { useSilenceSubmit } from '../useSilenceSubmit';
import { SilenceCountdown } from './SilenceCountdown';

interface ChatMessage {
  from: 'nikolai' | 'you';
  text: string;
  links?: NikolaiLink[];
  attachment?: string;
  error?: boolean;
}

/** An auto-opened mic with nothing said switches off after this long. */
const IDLE_MIC_MS = 30_000;

/** Tools that change data; after them, open pages reload. */
const WRITE_TOOLS = new Set(['add_company', 'add_interviewer', 'start_interview']);

/**
 * Nikolai: a floating button (bottom right) that opens a chat with the in-app assistant. Type or dictate (the mic
 * sends after 5 s of silence, on Enter, or when clicked off), attach a resume for starting interviews, and hear his
 * replies in his Russian-accented voice; when he finishes speaking, the mic opens for your answer. Starting an
 * interview opens its room.
 */
export function NikolaiWidget() {
  const hidden = useNikolaiHidden();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [{ from: 'nikolai', text: nikolaiGreeting() }]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  // Hands-free (default on): he speaks his replies, the mic opens when he finishes, and silence sends.
  // Off: quiet text chat; the mic only listens when clicked.
  const [handsFree, setHandsFree] = useState(true);
  const voice = useNikolaiVoice();
  const [mic, setMic] = useState<'off' | 'starting' | 'on'>('off');
  const [partial, setPartial] = useState('');
  const greeted = useRef(false);
  const listener = useRef<Listener | null>(null);
  const starting = useRef(false); // listen() still connecting
  const inputRef = useRef('');
  const viewport = useRef<HTMLDivElement>(null);

  // Hands-free dictation: after the chosen pause (Preferences, default 5 s) send what was said; nothing said,
  // nothing sent. The countdown shows for the last 3 s (or the last 60% of a short pause).
  const chatPauseMs = usePref(CHAT_PAUSE) * 1000;
  const chatSilence = useMemo(() => ({ submitMs: chatPauseMs, warningMs: Math.max(chatPauseMs - 3000, chatPauseMs * 0.4) }),
    [chatPauseMs]);
  const silence = useSilenceSubmit(mic === 'on' && !sending && handsFree, () => inputRef.current.trim().length > 0,
    () => { void stopMic(); }, chatSilence);

  // A mic opened with nothing said for 30 s switches itself off, so it never stays live unnoticed.
  const lastSpeechAt = useRef(0);
  useEffect(() => {
    if (mic !== 'on') return;
    lastSpeechAt.current = Date.now();
    const timer = setInterval(() => {
      if (!inputRef.current.trim() && Date.now() - lastSpeechAt.current > IDLE_MIC_MS) void stopMic(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [mic]);

  // While dictating, Enter sends straight away, wherever the focus is (Shift+Enter still types a new line).
  useEffect(() => {
    if (mic !== 'on' || !open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return;
      // Leave Enter alone in other fields on the page (e.g. a search box).
      const target = e.target as HTMLElement | null;
      const editable = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (editable && !editable.closest('.nikolai-panel')) return;
      e.preventDefault();
      void stopMic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mic, open]);

  const updateInput = (text: string) => {
    inputRef.current = text;
    setInput(text);
  };

  useEffect(() => {
    checkSpeech().then((s) => setVoiceReady(s.enabled));
  }, []);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, partial, open]);

  // Leaving (closing the chat, or a page hiding him) stops his voice and the mic.
  useEffect(() => {
    if (open && !hidden) return;
    hush();
    void (listener.current ? listener.current.stop() : starting.current && cancelListening());
    listener.current = null;
    setMic('off');
    setPartial('');
  }, [open, hidden]);

  // Latest values for callbacks that finish later (speech ending), and a counter that any interruption bumps.
  const live = useRef({ open, handsFree, sending });
  live.current = { open, handsFree, sending };
  const speechTurn = useRef(0);

  /** Stops his voice and cancels listening-after-speaking for whatever he was saying. */
  const hush = () => {
    speechTurn.current++;
    stopSpeaking();
  };

  /** Speaks, and when he has finished (not interrupted), opens the mic so the user can answer straight away. */
  const say = async (text: string) => {
    if (!voiceReady || !handsFree) return;
    const turn = ++speechTurn.current;
    try {
      await speak(text, voice);
    } catch {
      return; // voice unavailable right now; the chat still works as text
    }
    const { open: stillOpen, handsFree: stillOn, sending: busy } = live.current;
    if (turn === speechTurn.current && stillOpen && stillOn && !busy && !listener.current) void startMic();
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // The click that opens the chat is the user gesture that lets him speak and the mic start. First time: he
    // greets you and then listens (say() opens the mic); afterwards, with hands-free on, he listens straight away.
    if (!greeted.current) {
      greeted.current = true;
      void say(messages[0].text);
    } else if (handsFree && voiceReady && !sending) {
      void startMic();
    }
  };

  const send = async (text = inputRef.current) => {
    const message = text.trim();
    if ((!message && !resume) || sending) return;
    hush();
    const attachment = resume;
    setMessages((m) => [...m, { from: 'you', text: message || 'Here is my resume.', attachment: attachment?.name }]);
    updateInput('');
    setResume(null);
    setSending(true);
    try {
      const reply = await api.nikolai.chat(conversationId, message || 'Here is my resume.', attachment);
      setConversationId(reply.conversationId);
      setMessages((m) => [...m, { from: 'nikolai', text: reply.reply, links: reply.links }]);
      if (reply.toolsUsed.some((t) => WRITE_TOOLS.has(t))) window.dispatchEvent(new Event(DATA_CHANGED));
      if (reply.navigateTo) {
        navigate(reply.navigateTo);
        setOpen(false); // the interview room takes over
      } else {
        void say(reply.reply);
      }
    } catch (err) {
      setMessages((m) => [...m, { from: 'nikolai', text: (err as Error).message, error: true }]);
      if (attachment) setResume(attachment); // let them retry with it
    } finally {
      setSending(false);
    }
  };

  const startMic = async () => {
    if (listener.current || starting.current || !voiceReady) return;
    stopSpeaking();
    setMic('starting');
    starting.current = true;
    try {
      listener.current = await listen({
        onPartial: (t) => {
          setPartial(t);
          if (t) {
            silence.heard();
            lastSpeechAt.current = Date.now();
          }
        },
        onFinal: (t) => {
          silence.heard();
          lastSpeechAt.current = Date.now();
          updateInput(inputRef.current ? `${inputRef.current} ${t}` : t);
        },
        onError: (msg) => {
          setMessages((m) => [...m, { from: 'nikolai', text: `Microphone: ${msg}`, error: true }]);
          void stopMic(false);
        },
      });
      setMic('on');
    } catch (e) {
      setMic('off');
      if (!(e instanceof ListenCancelled)) {
        setMessages((m) => [...m, { from: 'nikolai', text: `Microphone: ${(e as Error).message}`, error: true }]);
      }
    } finally {
      starting.current = false;
    }
  };

  /** Stops dictation and, by default, sends what was said. */
  const stopMic = async (andSend = true) => {
    const l = listener.current;
    listener.current = null;
    setMic('off');
    if (l) await l.stop();
    else if (starting.current) await cancelListening(); // still connecting: don't let it open afterwards
    setPartial('');
    if (andSend && inputRef.current.trim()) void send();
  };

  /** Turning hands-free off silences him and closes an open mic (without sending); on, it starts listening. */
  const toggleHandsFree = () => {
    if (handsFree) {
      hush();
      void stopMic(false);
    } else if (!sending) {
      void startMic();
    }
    setHandsFree(!handsFree);
  };

  /** Clears the chat back to the greeting and starts a fresh session (the server forgets the old one). */
  const newChat = () => {
    hush();
    void stopMic(false);
    if (conversationId) api.nikolai.forget(conversationId).catch(() => { /* it expires on its own */ });
    setConversationId(null);
    const greeting = nikolaiGreeting();
    setMessages([{ from: 'nikolai', text: greeting }]);
    void say(greeting);
    updateInput('');
    setResume(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Dictating: stop the mic and send what was said; otherwise just send.
      void (mic === 'on' ? stopMic() : send());
    }
  };

  if (hidden) return null;

  return (
    <>
      <Transition mounted={open} transition="pop-bottom-right" duration={180}>
        {(style) => (
          <Paper style={style} className="nikolai-panel" shadow="xl" withBorder>
            <Group justify="space-between" p="sm" className="nikolai-head" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Avatar src={nikolaiAvatar} size={40} radius="xl" />
                <div>
                  <Text fw={700} lh={1.2}>{NIKOLAI.name}</Text>
                  <Text size="xs" c="dimmed">Your interview coach</Text>
                </div>
              </Group>
              <Group gap={4} wrap="nowrap">
                <Tooltip label="New chat: clear this conversation and start fresh">
                  <ActionIcon variant="subtle" color="gray" size="lg" aria-label="New chat" onClick={newChat}
                    disabled={sending || messages.length <= 1}>
                    <IconMessagePlus size={18} />
                  </ActionIcon>
                </Tooltip>
                {voiceReady && (
                  <Tooltip multiline w={240} label={handsFree
                    ? 'Hands-free is on: Nikolai speaks, then listens; a 5 s pause sends. Click for a quiet text chat.'
                    : 'Hands-free is off: Nikolai stays quiet and the mic only listens when you click it.'}>
                    <ActionIcon size="lg" variant={handsFree ? 'filled' : 'subtle'}
                      color={handsFree ? undefined : 'gray'} onClick={toggleHandsFree} aria-pressed={handsFree}
                      aria-label={handsFree ? 'Hands-free on' : 'Hands-free off'}>
                      {handsFree ? <IconHeadset size={18} /> : <IconHeadsetOff size={18} />}
                    </ActionIcon>
                  </Tooltip>
                )}
                <CloseButton onClick={() => setOpen(false)} aria-label="Close chat" />
              </Group>
            </Group>

            <ScrollArea className="nikolai-log" viewportRef={viewport} px="sm">
              <Stack gap="sm" py="sm">
                {messages.map((m, i) => (
                  <div key={i} className={`nikolai-msg ${m.from}`}>
                    <div className={`nikolai-bubble ${m.from} ${m.error ? 'error' : ''}`}>
                      {m.attachment && <Badge size="xs" variant="white" mb={4} leftSection={<IconPaperclip size={10} />}>{m.attachment}</Badge>}
                      <Text size="sm" className="pre-wrap">{m.text}</Text>
                    </div>
                    {m.links && m.links.length > 0 && (
                      <Group gap={6} mt={6}>
                        {m.links.map((l) => (
                          <Button key={l.to} component={Link} to={l.to} size="compact-xs" variant="light"
                            onClick={() => setOpen(false)}>
                            {l.label}
                          </Button>
                        ))}
                      </Group>
                    )}
                  </div>
                ))}
                {sending && (
                  <Group gap="xs" className="nikolai-msg nikolai">
                    <div className="nikolai-bubble nikolai"><Loader size="xs" type="dots" /></div>
                  </Group>
                )}
              </Stack>
            </ScrollArea>

            <Stack gap={6} p="sm" className="nikolai-composer">
              <SilenceCountdown remainingMs={silence.remainingMs} action="Sending" timing={chatSilence}
                hint="Keep talking, or press Enter to send now" />
              {partial && <Text size="xs" c="dimmed" fs="italic">{partial}…</Text>}
              {resume && (
                <Group gap={4}>
                  <Badge variant="light" leftSection={<IconPaperclip size={12} />}
                    rightSection={<IconX size={12} className="clickable" onClick={() => setResume(null)} />}>
                    {resume.name}
                  </Badge>
                </Group>
              )}
              <Group gap={6} align="flex-end" wrap="nowrap">
                <FileButton onChange={setResume} accept=".pdf,.txt,.md,application/pdf,text/plain">
                  {(props) => (
                    <Tooltip label="Attach a resume for starting interviews">
                      <ActionIcon {...props} variant="subtle" color="gray" size="lg" aria-label="Attach resume">
                        <IconPaperclip size={18} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </FileButton>
                <Textarea style={{ flex: 1 }} autosize minRows={1} maxRows={5} value={input}
                  onChange={(e) => { speechTurn.current++; updateInput(e.currentTarget.value); }} onKeyDown={onKeyDown}
                  placeholder={mic === 'on' ? (handsFree ? 'Listening… pause or press Enter to send' : 'Listening… press Enter to send') : 'Type or speak to Nikolai…'} />
                {voiceReady && (
                  <Tooltip label={mic === 'on' ? 'Stop and send (Enter)' : 'Speak'}>
                    <ActionIcon size="lg" variant={mic === 'on' ? 'filled' : 'light'}
                      color={mic === 'on' ? 'red' : undefined} loading={mic === 'starting'} disabled={sending}
                      onClick={() => (mic === 'on' ? stopMic() : startMic())} aria-label="Speak to Nikolai">
                      {mic === 'on' ? <IconMicrophone size={18} /> : <IconMicrophoneOff size={18} />}
                    </ActionIcon>
                  </Tooltip>
                )}
                <ActionIcon size="lg" onClick={() => send()} loading={sending}
                  disabled={!input.trim() && !resume} aria-label="Send">
                  <IconSend size={18} />
                </ActionIcon>
              </Group>
            </Stack>
          </Paper>
        )}
      </Transition>

      <Affix position={{ bottom: 24, right: 24 }} zIndex={200}>
        <Tooltip label={open ? 'Close chat' : 'Talk to Nikolai'} position="left">
          <button type="button" className={`nikolai-fab ${open ? 'open' : ''}`} onClick={toggleOpen}
            aria-label={open ? 'Close chat with Nikolai' : 'Talk to Nikolai'}>
            <img src={nikolaiAvatar} alt="" />
          </button>
        </Tooltip>
      </Affix>
    </>
  );
}
