import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

/**
 * Azure AI Speech in the browser. The backend exchanges its key for 10-minute tokens (/api/speech/token);
 * the key itself never reaches the client.
 */

interface Credentials {
  token: string;
  region: string;
  expires: number;
}

let cached: Credentials | null = null;

/** Stop reusing a token this long before it expires, so a call never starts with one about to lapse. */
const EXPIRY_MARGIN_MS = 60_000;

async function credentials(): Promise<Credentials> {
  if (cached && Date.now() < cached.expires) return cached;
  const res = await fetch('/api/speech/token');
  const body = await res.json();
  if (!res.ok || !body.enabled) throw new Error(body.reason ?? 'Voice is unavailable.');
  // The backend reuses tokens too, so go by the lifetime it reports, not the time we fetched it.
  const validMs = (typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 300) * 1000;
  cached = { token: body.token, region: body.region, expires: Date.now() + validMs - EXPIRY_MARGIN_MS };
  return cached;
}

/**
 * Azure refuses an expired or revoked token by dropping the websocket, which surfaces as "Unable to contact server"
 * / code 1006 (or 401). Such failures are retried once with a fresh token.
 */
const isConnectionError = (e: unknown) =>
  /1006|unable to contact server|401|unauthori[sz]ed|authenticat/i.test((e as Error)?.message ?? String(e));

export async function checkSpeech(): Promise<{ enabled: boolean; reason: string | null }> {
  try {
    await credentials();
    return { enabled: true, reason: null };
  } catch (e) {
    return { enabled: false, reason: (e as Error).message };
  }
}

// --- Text to speech -------------------------------------------------------------------------------------

/** Speaking rate for every voice; 0% is the voice's normal pace (e.g. '+10%' to speed up). */
const SPEAKING_RATE = '0%';

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

function ssml(text: string, voice: string) {
  const lang = voice.split('-').slice(0, 2).join('-');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">`
    + `<voice name="${escapeXml(voice)}"><prosody rate="${SPEAKING_RATE}">${escapeXml(text)}</prosody></voice></speak>`;
}

let generation = 0;
let stopCurrent: (() => void) | null = null;

/** Stops whatever is playing, and cancels any speak() still fetching credentials. */
export function stopSpeaking() {
  generation++;
  stopCurrent?.();
  stopCurrent = null;
}

/**
 * Speaks `text` in `voice`. Resolves when playback ends or is stopped; resolves without speaking if another
 * speak()/stopSpeaking() supersedes it first.
 */
export async function speak(text: string, voice: string, onStart?: () => void): Promise<void> {
  stopSpeaking();
  const mine = generation;
  try {
    await speakOnce(text, voice, mine, onStart);
  } catch (e) {
    if (!isConnectionError(e) || mine !== generation) throw e;
    cached = null; // the token was refused: fetch a new one and try once more
    await speakOnce(text, voice, mine, onStart);
  }
}

async function speakOnce(text: string, voice: string, mine: number, onStart?: () => void): Promise<void> {
  const { token, region } = await credentials();
  if (mine !== generation) return;

  const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  const player = new sdk.SpeakerAudioDestination();
  const synth = new sdk.SpeechSynthesizer(config, sdk.AudioConfig.fromSpeakerOutput(player));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (stopCurrent === stop) stopCurrent = null;
      if (err) reject(err);
      else resolve();
    };
    const stop = () => {
      player.pause();
      player.close();
      settle();
    };
    stopCurrent = stop;

    player.onAudioStart = () => onStart?.();
    player.onAudioEnd = () => settle();
    synth.speakSsmlAsync(
      ssml(text, voice),
      (result) => {
        synth.close();
        if (result.reason === sdk.ResultReason.Canceled) {
          settle(new Error(sdk.CancellationDetails.fromResult(result).errorDetails));
        }
      },
      (err) => {
        synth.close();
        settle(new Error(err));
      },
    );
  });
}

// --- Speech to text -------------------------------------------------------------------------------------

export interface Listener {
  stop: () => Promise<void>;
}

/** Thrown by listen() when cancelListening() or a newer listen() supersedes it while it is still connecting. */
export class ListenCancelled extends Error {
  constructor() {
    super('Listening was cancelled');
  }
}

// At most one recognizer is open at a time: Azure's free tier allows one concurrent recognition and refuses a
// second with "Quota exceeded" (websocket 1007). Starting takes a token fetch and a websocket handshake, so a
// stop can arrive before the caller has a Listener; the generation counter lets that stop cancel the start.
let micGeneration = 0;
let active: Listener | null = null;

/** Closes the open recognizer, if any, and cancels a listen() still connecting. */
export function cancelListening(): Promise<void> {
  micGeneration++;
  const current = active;
  active = null;
  return current ? current.stop() : Promise.resolve();
}

/**
 * Continuous dictation from the default microphone. `onPartial` streams the in-progress phrase. Closes any
 * recognizer already open first; rejects with ListenCancelled if superseded before it is listening.
 */
export async function listen(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}): Promise<Listener> {
  await cancelListening();
  const mine = micGeneration;
  try {
    return await listenOnce(handlers, mine);
  } catch (e) {
    if (e instanceof ListenCancelled) throw e;
    if (mine !== micGeneration) throw new ListenCancelled();
    if (!isConnectionError(e)) throw e;
    cached = null; // the token was refused: fetch a new one and try once more
    return listenOnce(handlers, mine);
  }
}

/**
 * Azure sometimes refuses a recognition with "Quota exceeded" (websocket 1007) even well within the resource's
 * limits; a few percent of connections, at random, at the start or mid-session. A dropped connection (1006) is
 * similar. Such a session is reopened instead of failing the dictation.
 */
const isTransientSttError = (details: string) => /1007|quota exceeded|1006|unable to contact server/i.test(details);
/** Reconnects in a row before giving up; the count resets whenever a phrase is recognised. */
const MAX_RECONNECTS = 5;

async function listenOnce(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}, mine: number): Promise<Listener> {
  let recognizer: sdk.SpeechRecognizer | null = null;
  let stopped = false;
  let stopping: Promise<void> | null = null;
  let failures = 0;

  const close = (rec: sdk.SpeechRecognizer) =>
    new Promise<void>((resolve) => {
      const done = () => {
        rec.close();
        resolve();
      };
      rec.stopContinuousRecognitionAsync(done, done);
    });

  const listener: Listener = {
    stop: () => {
      stopped = true;
      if (active === listener) active = null;
      const rec = recognizer;
      recognizer = null;
      stopping ??= rec ? close(rec) : Promise.resolve();
      return stopping;
    },
  };

  const fail = (message: string) => {
    if (stopped) return;
    void listener.stop(); // don't leave the recognizer (and the mic) open
    handlers.onError(message);
  };

  const open = async (): Promise<void> => {
    const { token, region } = await credentials();
    if (stopped || mine !== micGeneration) throw new ListenCancelled();
    const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
    config.speechRecognitionLanguage = 'en-US';
    const rec = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromDefaultMicrophoneInput());

    rec.recognizing = (_, e) => handlers.onPartial(e.result.text);
    rec.recognized = (_, e) => {
      failures = 0;
      handlers.onPartial('');
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) handlers.onFinal(e.result.text);
    };
    rec.canceled = (_, e) => {
      if (e.reason !== sdk.CancellationReason.Error || rec !== recognizer) return;
      recognizer = null;
      rec.close();
      if (stopped) return;
      if (!isTransientSttError(e.errorDetails) || failures >= MAX_RECONNECTS) {
        fail(e.errorDetails);
        return;
      }
      failures++;
      if (/1006|unable to contact server/i.test(e.errorDetails)) cached = null; // maybe a refused token
      handlers.onPartial('');
      window.setTimeout(() => {
        if (!stopped) open().catch((err) => { if (!(err instanceof ListenCancelled)) fail((err as Error).message); });
      }, 200 * failures);
    };

    recognizer = rec;
    try {
      await new Promise<void>((resolve, reject) =>
        rec.startContinuousRecognitionAsync(resolve, (err) => reject(new Error(err))),
      );
    } catch (e) {
      if (recognizer === rec) recognizer = null;
      rec.close();
      throw e;
    }
    if (stopped && recognizer === rec) { // stopped while connecting
      recognizer = null;
      await close(rec);
    }
  };

  await open();
  if (mine !== micGeneration) {
    await listener.stop();
    throw new ListenCancelled();
  }
  active = listener;
  return listener;
}
