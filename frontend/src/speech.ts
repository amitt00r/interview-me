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

/** Continuous dictation from the default microphone. `onPartial` streams the in-progress phrase. */
export async function listen(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}): Promise<Listener> {
  try {
    return await listenOnce(handlers);
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    cached = null; // the token was refused: fetch a new one and try once more
    return listenOnce(handlers);
  }
}

async function listenOnce(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}): Promise<Listener> {
  const { token, region } = await credentials();
  const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  config.speechRecognitionLanguage = 'en-US';
  const recognizer = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromDefaultMicrophoneInput());

  recognizer.recognizing = (_, e) => handlers.onPartial(e.result.text);
  recognizer.recognized = (_, e) => {
    handlers.onPartial('');
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) handlers.onFinal(e.result.text);
  };
  recognizer.canceled = (_, e) => {
    if (e.reason === sdk.CancellationReason.Error) handlers.onError(e.errorDetails);
  };

  await new Promise<void>((resolve, reject) =>
    recognizer.startContinuousRecognitionAsync(resolve, (err) => reject(new Error(err))),
  );

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        const done = () => {
          recognizer.close();
          resolve();
        };
        recognizer.stopContinuousRecognitionAsync(done, done);
      }),
  };
}
