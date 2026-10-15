import {
  BUILT_IN_BANNED_WORDS,
  MIN_BANNED_WORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../constants/password';
import { BREACHED_PASSWORD_LINES } from '../constants/breached-passwords';
import { COMMON_PASSWORDS } from '../constants/common-passwords';

const COMMON = new Set(COMMON_PASSWORDS);

let breached: Set<string> | null = null;

/** The breached set, built on the first password checked so a boot that never checks one does not pay for it. */
function breachedSet(): Set<string> {
  breached ??= new Set(BREACHED_PASSWORD_LINES.flatMap((line) => line.split(' ')));
  return breached;
}

/** Folds case and compatibility forms, so `ＰＡＳＳＷＯＲＤ` and `Password` compare equal. */
function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

/**
 * Splits `PASSWORD_BANNED_WORDS` into the words a password may not contain.
 * Words shorter than the minimum are dropped.
 *
 * @param raw - Comma separated words, usually the site and organisation names.
 */
export function parseBannedWords(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((word) => normalize(word.trim()))
    .flatMap((word) => [word, word.replace(/\s+/g, '')])
    .filter(
      (word, index, all) => word.length >= MIN_BANNED_WORD_LENGTH && all.indexOf(word) === index
    );
}

/**
 * Builds the `validatePassword` hook of users-permissions for reader passwords.
 *
 * @remarks
 * The plugin calls it on sign-up, reset and change, and shows the message of
 * the error it throws. There are no composition rules (ASVS V6.2.5) and no
 * upper length here: the plugin's own 72-byte maximum stays.
 *
 * @param extraWords - Site words from `parseBannedWords`, added to the built-in ones.
 * @throws `Error` with a message for the reader when the password is too short, common, in the breached list or has a banned word.
 */
export function createPasswordValidator(
  extraWords: readonly string[] = []
): (value: unknown) => boolean {
  const banned = [...BUILT_IN_BANNED_WORDS, ...extraWords];
  return (value: unknown): boolean => {
    if (typeof value !== 'string') throw new Error('Password must be a string');
    if (Array.from(value).length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must have at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const folded = normalize(value);
    if (COMMON.has(folded)) throw new Error('Password is too common, choose another');
    if (breachedSet().has(folded)) {
      throw new Error('Password appears in known data breaches, choose another');
    }
    if (banned.some((word) => folded.includes(word))) {
      throw new Error('Password contains a word tied to this site, choose another');
    }
    return true;
  };
}
