import { createHash } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { generateCryptoKeyPair, signRequest } from '@fedify/fedify';
import { Person, CryptographicKey, Image } from '@fedify/fedify/vocab';
import type { ActivityJson } from './api-types';

const ACTIVITY_JSON = 'application/activity+json';

/**
 * Spins up a minimal HTTP server that plays the "remote fediverse server"
 * role in tests: it serves an ActivityPub actor document with an embedded
 * public key — so our plugin's inbound HTTP-signature verification and
 * `ctx.lookupObject()` calls have something real to dereference — and it
 * records any activity POSTed to its inbox (e.g. the signed `Accept` our
 * plugin sends back for a `Follow`).
 */
interface RemoteActorOptions {
  preferredUsername?: string;
  name?: string;
  iconUrl?: string;
  /**
   * The icon's `url` exactly as the remote server would write it, unparsed, so a
   * test can send a value `new URL()` would reject (a relative path). Wins over `iconUrl`.
   */
  rawIconUrl?: string;
}

/** RFC 3230 algorithm names a test may put in the `Digest` header, mapped to `node:crypto` hashes. */
const DIGEST_HASHES = { SHA: 'sha1', 'SHA-256': 'sha256', 'SHA-512': 'sha512' } as const;

type DigestAlgorithm = keyof typeof DIGEST_HASHES;

interface SignOptions {
  /**
   * Algorithms of the `Digest` header, in order, each with the correct digest of
   * the body. Unset, `signRequest` adds `SHA-256` as a real server would.
   */
  digest?: readonly DigestAlgorithm[];
}

/** A `Digest` header (`SHA=…, SHA-256=…`) with the correct value of each algorithm for `body`. */
function digestHeader(body: string, algorithms: readonly DigestAlgorithm[]): string {
  return algorithms
    .map((name) => `${name}=${createHash(DIGEST_HASHES[name]).update(body).digest('base64')}`)
    .join(', ');
}

async function createRemoteActor({
  preferredUsername = 'remote-test',
  name,
  iconUrl,
  rawIconUrl,
}: RemoteActorOptions = {}) {
  const keyPair = await generateCryptoKeyPair();
  // Parsed JSON bodies, as remote servers would receive them.
  const inboxDeliveries: ActivityJson[] = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/actor') {
      void (async () => {
        try {
          const doc = await buildActorDocument();
          res.writeHead(200, { 'content-type': ACTIVITY_JSON });
          res.end(JSON.stringify(doc));
        } catch (error) {
          res.writeHead(500);
          res.end(String(error));
        }
      })();
      return;
    }

    if (req.method === 'POST' && req.url === '/inbox') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          inboxDeliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          // Malformed body: nothing to record, still ack the delivery below.
        }
        res.writeHead(202);
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const actorUrl = `http://127.0.0.1:${port}/actor`;
  const inboxUrl = `http://127.0.0.1:${port}/inbox`;
  const keyId = new URL(`${actorUrl}#main-key`);

  async function buildActorDocument() {
    const key = new CryptographicKey({
      id: keyId,
      owner: new URL(actorUrl),
      publicKey: keyPair.publicKey,
    });
    const person = new Person({
      id: new URL(actorUrl),
      preferredUsername,
      name,
      icon: iconUrl ? new Image({ url: new URL(iconUrl) }) : undefined,
      inbox: new URL(inboxUrl),
      publicKey: key,
    });
    const doc = (await person.toJsonLd({ format: 'compact' })) as Record<string, unknown>;
    return rawIconUrl === undefined ? doc : { ...doc, icon: { type: 'Image', url: rawIconUrl } };
  }

  async function signActivity(
    url: string,
    activity: unknown,
    { digest }: SignOptions = {}
  ): Promise<Request> {
    const body = JSON.stringify(activity);
    const headers: Record<string, string> = { 'content-type': ACTIVITY_JSON };
    // `signRequest` signs a `Digest` already set and adds `SHA-256` only when there is none.
    if (digest) headers.digest = digestHeader(body, digest);
    const request = new Request(url, { method: 'POST', headers, body });
    return signRequest(request, keyPair.privateKey, keyId);
  }

  return {
    actorUrl,
    inboxUrl,
    keyId,
    inboxDeliveries,
    /** Builds an HTTP-signed POST of `activity` to `url` as this remote actor, without sending it. */
    signActivity,
    /** Builds and HTTP-signs a POST of `activity` to `url` as this remote actor. */
    async postSignedActivity(url: string, activity: unknown, options?: SignOptions) {
      return fetch(await signActivity(url, activity, options));
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

/** A running fake remote server, as `createRemoteActor` returns it. */
type RemoteActor = Awaited<ReturnType<typeof createRemoteActor>>;

export { createRemoteActor, type RemoteActor };
