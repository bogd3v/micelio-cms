/** Fediverse replies ingested as comments. */

/** A remote `Note` that may reply to an article or to a stored reply. */
export interface IncomingReply {
  /** The remote Note's id. */
  uri: string;
  /** What the Note replies to (`inReplyTo`). */
  inReplyTo: string;
  contentHtml: string;
  actorId: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
}

/** What reply handling needs from the federation: the blog's usernames and its article ids. */
export interface ReplyContext {
  /** Usernames the blog is mentioned by: its current handle and any former one. */
  actorUsernames: string[];
  /** Maps one of our ActivityPub article ids to its documentId, or null. */
  parseArticleUri(uri: string): string | null;
}

/**
 * Outcome of storing, editing or removing a reply: the comment it changed, or
 * why nothing changed.
 */
export type IngestResult =
  { status: 'applied'; documentId: string } | { status: 'ignored'; reason: string };
