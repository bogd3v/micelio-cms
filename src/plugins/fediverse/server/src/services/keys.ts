import type { Core } from '@strapi/strapi';

import { generateCryptoKeyPair } from '@fedify/fedify';

import {
  decryptText,
  encryptText,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from '../utils/key-encryption';

type PluginStore = Awaited<ReturnType<Core.Strapi['store']>>;

const STORE_KEY = 'keyPairs';

interface StoredKeyPair {
  /**
   * Stable fragment name for the key id. Fedify assigns the actual key id
   * (`<actorUri>#main-key`, `<actorUri>#key-2`, ...) from the array order,
   * so this is informational only.
   */
  name: string;
  publicJwk: JsonWebKey;
  /** Encrypted with `ENCRYPTION_KEY`; plain only when written without a key (outside production). */
  privateJwk: JsonWebKey | EncryptedEnvelope;
  algorithm: string;
  generatedAt: string;
}

interface ActorKeyPairResult {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const RSA_IMPORT_PARAMS: RsaHashedImportParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
};

function isStoredKeyPairs(value: unknown): value is StoredKeyPair[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        entry != null &&
        typeof entry === 'object' &&
        typeof entry.name === 'string' &&
        entry.publicJwk != null &&
        entry.privateJwk != null
    )
  );
}

async function getStore(strapi: Core.Strapi): Promise<PluginStore> {
  return strapi.store({ type: 'plugin', name: 'fediverse' });
}

let warnedPlainKey = false;

/** The raw `ENCRYPTION_KEY`, read the way Strapi's own encryption service reads it. */
function configuredEncryptionKey(strapi: Core.Strapi): string | null {
  const value: unknown = strapi.config.get('admin.secrets.encryptionKey');
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Encrypts the stored private keys still kept as plain JWK. `null` when there
 * is nothing to rewrite (already encrypted, or no `ENCRYPTION_KEY`).
 */
function sealPlainEntries(strapi: Core.Strapi, entries: StoredKeyPair[]): StoredKeyPair[] | null {
  const key = configuredEncryptionKey(strapi);
  if (entries.every((entry) => isEncryptedEnvelope(entry.privateJwk))) return null;
  if (!key) {
    if (!warnedPlainKey) {
      warnedPlainKey = true;
      strapi.log.warn(
        '[fediverse] ENCRYPTION_KEY is not set: the actor private key is stored unencrypted'
      );
    }
    return null;
  }
  return entries.map((entry) =>
    isEncryptedEnvelope(entry.privateJwk)
      ? entry
      : { ...entry, privateJwk: encryptText(JSON.stringify(entry.privateJwk), key) }
  );
}

/**
 * Encrypts a stored actor key pair that predates encryption at rest, so the
 * database no longer holds the plain private JWK. Run at boot.
 *
 * @remarks
 * Idempotent: an encrypted entry is never touched, so a wrong `ENCRYPTION_KEY`
 * cannot fail the boot here; it fails at first use instead. Without a key
 * (outside production) it only warns. The key material, and so the actor
 * identity, does not change.
 */
export async function encryptStoredActorKeys(strapi: Core.Strapi): Promise<void> {
  const store = await getStore(strapi);
  const stored: unknown = await store.get({ key: STORE_KEY });
  if (!isStoredKeyPairs(stored)) return;
  const sealed = sealPlainEntries(strapi, stored);
  if (!sealed) return;
  await store.set({ key: STORE_KEY, value: sealed });
  strapi.log.info('[fediverse] encrypted the stored actor private key with ENCRYPTION_KEY');
}

/**
 * Returns the blog actor's key pairs, generating and persisting them in the
 * plugin store on first use. Persisted as JWKs (WebCrypto export), so the
 * actor identity survives restarts — remote followers would otherwise break
 * on every deploy. Key ids are derived by Fedify from the current request
 * origin, which keeps them valid across dev/staging/prod domains.
 *
 * @remarks
 * The private JWK is stored encrypted with `ENCRYPTION_KEY`; a plain one is
 * encrypted on first use. A stored key is never replaced because it fails to
 * decrypt: that would change the actor identity for every follower.
 *
 * @throws `ActorKeyDecryptionError`, naming `ENCRYPTION_KEY`, when a stored
 * private key cannot be decrypted. The store is left as it was.
 */
export async function getActorKeyPairs(strapi: Core.Strapi): Promise<ActorKeyPairResult[]> {
  const store = await getStore(strapi);
  const stored: unknown = await store.get({ key: STORE_KEY });

  if (isStoredKeyPairs(stored)) {
    const key = configuredEncryptionKey(strapi);
    const pairs = await Promise.all(
      stored.map(async (entry) => ({
        publicKey: await crypto.subtle.importKey('jwk', entry.publicJwk, RSA_IMPORT_PARAMS, true, [
          'verify',
        ]),
        privateKey: await crypto.subtle.importKey(
          'jwk',
          isEncryptedEnvelope(entry.privateJwk)
            ? (JSON.parse(decryptText(entry.privateJwk, key)) as JsonWebKey)
            : entry.privateJwk,
          RSA_IMPORT_PARAMS,
          true,
          ['sign']
        ),
      }))
    );
    const sealed = sealPlainEntries(strapi, stored);
    if (sealed) await store.set({ key: STORE_KEY, value: sealed });
    return pairs;
  }

  // No persisted key pairs (first boot, or store wiped): generate one.
  const generated = await generateCryptoKeyPair();
  const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
  const entry: StoredKeyPair = {
    name: 'main-key',
    publicJwk: await crypto.subtle.exportKey('jwk', generated.publicKey),
    privateJwk,
    algorithm: generated.publicKey.algorithm.name,
    generatedAt: new Date().toISOString(),
  };
  await store.set({ key: STORE_KEY, value: sealPlainEntries(strapi, [entry]) ?? [entry] });
  strapi.log.info('[fediverse] generated and persisted a new actor key pair');

  return [
    {
      publicKey: await crypto.subtle.importKey('jwk', entry.publicJwk, RSA_IMPORT_PARAMS, true, [
        'verify',
      ]),
      privateKey: await crypto.subtle.importKey('jwk', privateJwk, RSA_IMPORT_PARAMS, true, [
        'sign',
      ]),
    },
  ];
}

/**
 * Returns the persisted JWK entries as stored, private keys encrypted
 * (test/debug helper; also lets tests prove persistence without re-deriving keys).
 */
export async function getStoredKeyPairEntries(
  strapi: Core.Strapi
): Promise<StoredKeyPair[] | null> {
  const store = await getStore(strapi);
  const stored: unknown = await store.get({ key: STORE_KEY });
  return isStoredKeyPairs(stored) ? stored : null;
}

export default (): {
  encryptStoredActorKeys: typeof encryptStoredActorKeys;
  getActorKeyPairs: typeof getActorKeyPairs;
  getStoredKeyPairEntries: typeof getStoredKeyPairEntries;
} => ({
  encryptStoredActorKeys,
  getActorKeyPairs,
  getStoredKeyPairEntries,
});
