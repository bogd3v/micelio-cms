import { describe, it, expect, afterEach } from '@jest/globals';
import { formatJsonLogLine, jsonLogFormat, type LogInfo } from '../src/utils/json-log-format';
import { Writable } from 'node:stream';
import { createLogger, winston } from '@strapi/logger';
import loggerConfig from '../config/logger';

// V16.2.2 and V16.2.4 (#180): one JSON object per line, timestamp in UTC.

const fixed = () => new Date('2026-10-14T10:00:00.123Z');

describe('formatJsonLogLine', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('writes one valid JSON line with timestamp, level and message', () => {
    const line = formatJsonLogLine({ level: 'info', message: 'hello' }, fixed);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-10-14T10:00:00.123Z',
      level: 'info',
      message: 'hello',
    });
  });

  it('keeps the metadata at the top level but never lets it overwrite the fixed fields', () => {
    const parsed = JSON.parse(
      formatJsonLogLine(
        {
          level: 'warn',
          message: 'm',
          requestId: 'r1',
          count: 3,
          timestamp: 'forged',
          nested: { a: 1 },
        },
        fixed
      )
    );
    expect(parsed).toMatchObject({
      level: 'warn',
      message: 'm',
      requestId: 'r1',
      count: 3,
      nested: { a: 1 },
    });
    expect(parsed.timestamp).toBe('2026-10-14T10:00:00.123Z');
  });

  it('puts an error message and stack in one string field on one line', () => {
    const error = new Error('boom');
    const line = formatJsonLogLine(
      { level: 'error', message: error.message, stack: error.stack },
      fixed
    );
    expect(line.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(line);
    expect(parsed.message).toContain('boom');
    expect(parsed.message).toContain('\n');
    expect(parsed.message).toContain('json-log-format.test');
    expect(parsed.stack).toBeUndefined();
  });

  it('drops the own properties of an error logged whole except name and code', () => {
    const error = Object.assign(new Error('duplicate key'), {
      name: 'DatabaseError',
      code: '23505',
      detail: 'Key (email)=(a@example.com) already exists.',
    });
    const line = formatJsonLogLine(
      { ...error, level: 'error', message: error.message, stack: error.stack },
      fixed
    );
    expect(line).not.toContain('a@example.com');
    const parsed = JSON.parse(line);
    expect(parsed.detail).toBeUndefined();
    expect(parsed).toMatchObject({ name: 'DatabaseError', code: '23505' });
  });

  it('writes an Error in metadata as message and stack only', () => {
    const error = Object.assign(new Error('failed'), { detail: 'Key (email)=(a@example.com)' });
    const parsed = JSON.parse(formatJsonLogLine({ level: 'warn', message: 'm', error }, fixed));
    expect(parsed.error).toContain('failed');
    expect(parsed.error).not.toContain('a@example.com');
  });

  it('writes an object message as JSON and a stack contained in the message once', () => {
    expect(JSON.parse(formatJsonLogLine({ level: 'info', message: { a: 1 } }, fixed)).message).toBe(
      '{"a":1}'
    );
    const stack = 'Error: x\n    at y';
    const parsed = JSON.parse(formatJsonLogLine({ level: 'error', message: stack, stack }, fixed));
    expect(parsed.message).toBe(stack);
  });

  it('serialises an Error passed as metadata on one line', () => {
    const line = formatJsonLogLine(
      { level: 'error', message: 'failed', cause: new Error('inner') },
      fixed
    );
    expect(line.split('\n')).toHaveLength(1);
    expect(JSON.parse(line).cause).toContain('inner');
  });

  it('cannot be forged by line breaks in the message', () => {
    const line = formatJsonLogLine({ level: 'info', message: 'a\n{"level":"error"}' }, fixed);
    expect(line.split('\n')).toHaveLength(1);
    expect(JSON.parse(line).level).toBe('info');
  });

  it('does not throw on circular metadata', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const parsed = JSON.parse(formatJsonLogLine({ level: 'info', message: 'm', loop }, fixed));
    expect(parsed).toMatchObject({ level: 'info', message: 'm' });
  });

  it.each(['America/Bogota', 'Asia/Kolkata', 'Pacific/Auckland'])(
    'ends the timestamp in Z whatever the TZ is (%s)',
    (tz) => {
      process.env.TZ = tz;
      const { timestamp } = JSON.parse(formatJsonLogLine({ level: 'info', message: 'm' }));
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Math.abs(Date.parse(timestamp) - Date.now())).toBeLessThan(5000);
    }
  );

  it('uses the UTC instant, not the local wall clock, under a non-UTC TZ', () => {
    process.env.TZ = 'Asia/Kolkata';
    const parsed = JSON.parse(formatJsonLogLine({ level: 'info', message: 'm' }, fixed));
    expect(parsed.timestamp).toBe('2026-10-14T10:00:00.123Z');
  });
});

describe('jsonLogFormat', () => {
  it('writes the line to the symbol winston reads', () => {
    const info: LogInfo = { level: 'info', message: 'x' };
    const out = jsonLogFormat.transform(info);
    expect(JSON.parse(String(out[Symbol.for('message')])).message).toBe('x');
  });
});

describe('the real Strapi logger with config/logger', () => {
  it('writes one parseable line to stdout for a whole error and for an { error } value', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const written: string[] = [];
    // A stream transport instead of the console: jest replaces `console`, and only the format is under test.
    const stream = new Writable({
      write(chunk, _encoding, done) {
        written.push(String(chunk));
        done();
      },
    });
    const logger = createLogger({
      level: 'http',
      ...(loggerConfig() as Parameters<typeof createLogger>[0]),
      transports: [new winston.transports.Stream({ stream })],
    });
    const withDetail = Object.assign(new Error('whole'), { detail: 'Key (email)=(a@example.com)' });
    try {
      logger.error(withDetail as never);
      logger.warn('wrapped', { error: new Error('inner') });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
    const lines = written.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const [whole, wrapped] = lines.map((l) => JSON.parse(l));
    expect(whole.message).toContain('whole');
    expect(whole.detail).toBeUndefined();
    expect(wrapped.error).toContain('inner');
    expect(wrapped.timestamp).toMatch(/Z$/);
  });
});

describe('config/logger', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('sets the JSON format in production and leaves Strapi default elsewhere', () => {
    process.env.NODE_ENV = 'production';
    expect(loggerConfig()).toEqual({ format: jsonLogFormat });
    process.env.NODE_ENV = 'development';
    expect(loggerConfig()).toEqual({});
  });
});
