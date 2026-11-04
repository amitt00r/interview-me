/**
 * Curated Azure neural voices offered when onboarding an interviewer. The Indian English HD voices
 * (DragonHD / MAI-Voice) come first: they sound the most natural.
 */
export const VOICES = [
  { id: 'en-IN-Arjun:DragonHDLatestNeural', label: 'Arjun HD · Indian English · male voice' },
  { id: 'en-IN-Dhruv:MAI-Voice-2.1', label: 'Dhruv HD · Indian English · male voice' },
  { id: 'en-IN-Neerja:DragonHDLatestNeural', label: 'Neerja HD · Indian English · female voice' },
  { id: 'en-IN-Meera:DragonHDLatestNeural', label: 'Meera HD · Indian English · female voice' },
  { id: 'en-IN-Lavanya:DragonHDLatestNeural', label: 'Lavanya HD · Indian English · female voice' },
  { id: 'en-IN-Diya:DragonHDLatestNeural', label: 'Diya HD · Indian English · female voice' },
  { id: 'en-IN-Aarti:DragonHDLatestNeural', label: 'Aarti HD · Indian English · female voice' },
  { id: 'en-IN-Priya:MAI-Voice-2.1', label: 'Priya HD · Indian English · female voice' },
  { id: 'en-US-AndrewNeural', label: 'Andrew · US English · male voice' },
  { id: 'en-US-AvaNeural', label: 'Ava · US English · female voice' },
  { id: 'en-US-BrianNeural', label: 'Brian · US English · male voice' },
  { id: 'en-US-EmmaNeural', label: 'Emma · US English · female voice' },
  { id: 'en-US-GuyNeural', label: 'Guy · US English · male voice' },
  { id: 'en-US-JennyNeural', label: 'Jenny · US English · female voice' },
  { id: 'en-US-DavisNeural', label: 'Davis · US English · male voice' },
  { id: 'en-US-AriaNeural', label: 'Aria · US English · female voice' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · British English · male voice' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia · British English · female voice' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat · Indian English · male voice' },
  { id: 'en-IN-NeerjaNeural', label: 'Neerja · Indian English · female voice' },
  { id: 'en-IN-KunalNeural', label: 'Kunal · Indian English · male voice' },
  { id: 'en-IN-AartiNeural', label: 'Aarti · Indian English · female voice' },
  { id: 'en-AU-WilliamNeural', label: 'William · Australian English · male voice' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha · Australian English · female voice' },
] as const;

// --- Default voices, matched to the interviewer's name -----------------------------------------------------

export type VoiceGender = 'female' | 'male';

const FEMALE_VOICES = VOICES.filter((v) => v.label.endsWith('female voice'));
const MALE_VOICES = VOICES.filter((v) => !v.label.endsWith('female voice'));

/** Common female first names whose endings don't give them away (or that the ending rule would misread). */
const FEMALE_NAMES = new Set([
  'aisha', 'alice', 'alison', 'amy', 'ann', 'anne', 'beth', 'carmen', 'caroline', 'catherine', 'charlotte', 'chloe',
  'claire', 'deborah', 'diane', 'elizabeth', 'ellen', 'emily', 'emma', 'esther', 'grace', 'hannah', 'helen', 'hope',
  'ingrid', 'isabel', 'jane', 'janet', 'jasmine', 'jennifer', 'jessica', 'joan', 'joy', 'judith', 'karen', 'kate',
  'kathryn', 'kim', 'lauren', 'leah', 'lily', 'lucy', 'madison', 'margaret', 'mary', 'megan', 'mei', 'meiling',
  'michelle', 'miriam', 'nicole', 'olivia', 'rachel', 'rebecca', 'ruth', 'sarah', 'sharon', 'shirley', 'sophie',
  'stephanie', 'susan', 'tiffany', 'vivian', 'yasmin', 'zoe', 'aarti', 'anjali', 'gauri', 'jyoti', 'lakshmi',
  'parvati', 'preeti', 'swati', 'yun', 'xin', 'ying', 'ling', 'hui', 'jing', 'yan', 'min', 'naomi', 'yuki', 'akiko',
  'ingrid', 'astrid', 'sigrid', 'liv', 'beatrice', 'eve', 'faith', 'gwen', 'irene', 'iris', 'june', 'kay', 'lynn',
  'maureen', 'noor', 'pam', 'rose', 'sue', 'tess', 'zeynep',
]);

/** Common male first names the ending rule would misread as female (many end in -a or -i). */
const MALE_NAMES = new Set([
  'aditya', 'akira', 'ali', 'alexei', 'andrea', 'andrei', 'ashish', 'dmitri', 'elia', 'giovanni', 'hari', 'ilya',
  'joshua', 'krishna', 'luca', 'luigi', 'mani', 'misha', 'mustafa', 'nikita', 'nikolai', 'nicolai', 'nicola', 'ravi',
  'rishi', 'sasha', 'sergei', 'shiva', 'surya', 'toshi', 'vasily', 'wei', 'yuri', 'zhi', 'jun', 'hiroshi', 'kenji',
  'takashi', 'satoshi', 'moshe', 'ezra', 'jonah', 'noah', 'elijah', 'micah', 'isaiah', 'zachariah', 'dana', 'kai',
  'jamie', 'raghu', 'vishnu', 'sri', 'kofi', 'tomasz', 'mikhail', 'oleg', 'boris',
]);

/**
 * Best guess at the gender of a person's first name, to pick a matching default voice: the name lists above, then
 * the usual endings (-a, -i, -ee, -ine, -elle, -ette …). Only a heuristic; pick a voice on the interviewer to override.
 */
export function genderFromName(name: string): VoiceGender {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}]/gu, '') ?? '';
  const joined = name.trim().split(/\s+/).slice(0, 2).join('').toLowerCase().replace(/[^\p{L}]/gu, '');
  if (FEMALE_NAMES.has(first) || FEMALE_NAMES.has(joined)) return 'female';
  if (MALE_NAMES.has(first)) return 'male';
  return /(a|i|ee|ie|ine|elle|ette|lyn|ah)$/.test(first) ? 'female' : 'male';
}

/**
 * The interviewer's chosen voice, or a stable default (by id) among the voices of the gender their name suggests.
 */
export const voiceFor = (i: { id: number; name: string; voice: string | null }) => {
  if (i.voice) return i.voice;
  const pool = genderFromName(i.name) === 'female' ? FEMALE_VOICES : MALE_VOICES;
  return pool[Math.abs(i.id) % pool.length].id;
};

export const voiceLabel = (id: string) => VOICES.find((v) => v.id === id)?.label ?? id;
