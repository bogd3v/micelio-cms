/**
 * JSON log lines for production (ASVS V16.2.2 and V16.2.4, #180): one object per
 * line, timestamp in ISO 8601 UTC. Pure: no Strapi or winston import, so it is
 * unit-tested alone and `config/logger.ts` only wires it in.
 */

/** The key winston's console transport reads the finished line from (`Symbol.for('message')`). */
const MESSAGE_SYMBOL = Symbol.for('message');

/** Fields the formatter owns: metadata cannot overwrite them. */
const RESERVED_KEYS = new Set(['timestamp', 'level', 'message', 'stack']);

/** Properties kept from an error logged whole; its other own properties (a database `detail`) can hold submitted values. */
const ERROR_KEPT_KEYS = new Set(['name', 'code']);

/** What winston hands to a format: the level, the message and any metadata. */
export type LogInfo = Record<string | symbol, unknown>;

/** Turns an `Error` into one string (message, then stack) so JSON escapes its line breaks. */
function errorToString(error: Error): string {
  if (!error.stack) return error.message;
  return error.stack.includes(error.message) ? error.stack : `${error.message}\n${error.stack}`;
}

/** Serialises a value for `JSON.stringify`: errors and bigints as strings. */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return errorToString(value);
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Stringifies without ever throwing; unserialisable metadata is replaced by a marker. */
function safeStringify(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry, replacer);
  } catch {
    // Circular metadata: keep the fixed fields, which are plain strings, and drop the rest.
    const { timestamp, level, message } = entry;
    return JSON.stringify({ timestamp, level, message, meta: '[unserialisable]' });
  }
}

/** A message as text; objects are written as JSON, not `[object Object]`. */
function messageToString(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message === undefined || message === null) return '';
  if (typeof message === 'object') {
    try {
      return JSON.stringify(message, replacer);
    } catch {
      return '[unserialisable]';
    }
  }
  return String(message);
}

/**
 * Formats one log entry as a single JSON line, without a trailing newline.
 *
 * @remarks
 * Emits `timestamp` (ISO 8601, UTC, ends in `Z`), `level`, `message`, then the
 * metadata spread at the top level. A `stack` (from an error logged whole) is
 * appended to `message`, so the stack lives in one string field and its line
 * breaks are escaped by JSON. Metadata cannot overwrite the three fixed fields.
 * For an error logged whole, only `name` and `code` are kept besides the fixed
 * fields: winston copies the error's own properties into the entry, and some
 * (a Postgres `detail`) repeat submitted values. An `Error` inside metadata is
 * written as its message and stack, nothing else.
 *
 * @param info - The entry as winston builds it.
 * @param now - The clock; injected for tests.
 */
export function formatJsonLogLine(info: LogInfo, now: () => Date = () => new Date()): string {
  let message = messageToString(info.message);
  const isWholeError = typeof info.stack === 'string';
  if (typeof info.stack === 'string' && !message.includes(info.stack)) {
    message = `${message}\n${info.stack}`;
  }

  const entry: Record<string, unknown> = {
    timestamp: now().toISOString(),
    level: String(info.level),
    message,
  };
  for (const [key, value] of Object.entries(info)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (isWholeError && !ERROR_KEPT_KEYS.has(key)) continue;
    entry[key] = value;
  }
  return safeStringify(entry);
}

/** A winston format (the `transform` contract) that writes each entry as a JSON line. */
export const jsonLogFormat: { transform: (info: LogInfo) => LogInfo } = {
  transform(info) {
    info[MESSAGE_SYMBOL] = formatJsonLogLine(info);
    return info;
  },
};
