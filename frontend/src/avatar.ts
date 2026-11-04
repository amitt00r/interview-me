import { createAvatar } from '@dicebear/core';
import { personas } from '@dicebear/collection';

const cache = new Map<string, string>();

/** The interviewer's own photo if set, otherwise an illustrated placeholder seeded by name. */
export function avatarFor(person: { name: string; photoUrl?: string | null }): string {
  if (person.photoUrl) return person.photoUrl;
  let uri = cache.get(person.name);
  if (!uri) {
    uri = createAvatar(personas, {
      seed: person.name,
      size: 256,
      backgroundColor: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'],
    }).toDataUri();
    cache.set(person.name, uri);
  }
  return uri;
}

/**
 * Nikolai's own face, drawn to fit his persona (a warm, theatrical Russian career coach with dry humour):
 * smiling eyes, a big walrus moustache with sideburns, a broad grin and a warm red top, rather than the
 * name-seeded random look interviewers get.
 */
export const nikolaiAvatar = createAvatar(personas, {
  seed: 'Nikolai',
  size: 256,
  hair: ['shortComboverChops'],
  hairColor: ['6c4545'],
  facialHair: ['walrus'],
  facialHairProbability: 100,
  eyes: ['happy'],
  mouth: ['bigSmile'],
  nose: ['mediumRound'],
  body: ['squared'],
  skinColor: ['eeb4a4'],
  clothingColor: ['e24553'],
  backgroundColor: ['ffdfbf'],
}).toDataUri();
