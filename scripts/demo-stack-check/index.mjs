// A scripted check of the demo stacks on the host's engine, Docker in CI and Podman on the factory host
// (bogd3v/micelio-cms#535): brings a compose file up under a project name of its own, with no override but `ports:`,
// rebuilds the site, reads what the stack serves and removes everything it started. docs/architecture/testing.md
// ("Demo stack check") and docs/architecture/ci-pipeline.md ("Demo stacks").
//
//   npm run test:demo-stacks -- --file compose.static.yml --rebuilds 2
//   npm run test:demo-stacks -- --file compose.demo.yml
//
// Reads MICELIO_CMS_IMAGE and, by file, MICELIO_BUILDER_IMAGE or MICELIO_IMAGE from the environment; it builds and
// removes no image. CHECK_TIMEOUT_SECONDS (300) bounds each wait. No secret is printed: the stacks write their own,
// and the admin it creates has a throwaway password that is never printed or written to a file.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { builderFailureLines, lastRebuildSucceeded, missingVariables, portsOverride, spawnOptions, STACKS } from './checks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIRST_ARTICLE = '/blog/starting-a-balcony-garden';

/** The `docker` commands in flight, so an interruption can stop them. */
const inFlight = new Set();

/**
 * Runs `docker` with the arguments and collects stdout and stderr together; resolves with the exit code, never rejects on a non-zero one.
 * The cleanup's commands (`cleanup`) run detached and are not tracked, so an interruption cannot kill them.
 */
function docker(args, { cleanup = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: ROOT, ...spawnOptions({ cleanup }) });
    if (!cleanup) inFlight.add(child);
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      inFlight.delete(child);
      resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString() });
    });
  });
}

/** A free port on 127.0.0.1: the OS gives one to a listener that is closed at once. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Polls `probe` until it returns a truthy value or `timeoutMs` passes; `describe` names what was awaited. */
async function waitFor(describe, probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${describe}`);
    await sleep(2000);
  }
}

/** The status a GET answers, or 0 when nothing listens yet. */
async function status(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status;
  } catch {
    return 0; // not listening yet: the next poll asks again
  }
}

/** CHECK_TIMEOUT_SECONDS as a positive integer (default 300); anything else stops the run, since a NaN deadline never expires. */
function timeoutSeconds() {
  const raw = process.env.CHECK_TIMEOUT_SECONDS ?? '300';
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error('CHECK_TIMEOUT_SECONDS must be a positive integer');
  return Number(raw);
}

/** Waits for the site of a static or landing stack to answer 200 at `/`. */
async function expectSite(url, timeoutMs) {
  await waitFor(`GET / of site to answer 200 at ${url}`, async () => (await status(url)) === 200, timeoutMs);
  console.log('site / 200');
}

/** The static and landing stacks: up, rebuilds, the site again, then the first admin reads the last rebuild. */
async function checkStatic(ctx, rebuilds) {
  const siteUrl = `http://127.0.0.1:${ctx.ports.site}/`;
  const up = await ctx.compose(['up', '-d', 'site']);
  if (up.code !== 0) throw new Error(`docker compose up exited ${up.code}:\n${up.output.split('\n').slice(-40).join('\n')}`);
  await expectSite(siteUrl, ctx.timeoutMs);
  for (let run = 1; run <= rebuilds; run += 1) {
    const result = await ctx.compose(['run', '--rm', 'build']);
    const lines = builderFailureLines(result.output);
    if (result.code !== 0 || lines.length > 0) {
      throw new Error(`rebuild ${run} exit ${result.code}${lines.length > 0 ? `:\n${lines.join('\n')}` : ''}`);
    }
    console.log(`rebuild ${run} exit 0`);
  }
  await expectSite(siteUrl, ctx.timeoutMs);

  const cms = `http://127.0.0.1:${ctx.ports.cms}`;
  const password = `Aa1-${randomBytes(12).toString('hex')}`;
  const email = `check-${randomBytes(4).toString('hex')}@example.com`;
  const admin = { email, password };
  const json = { 'content-type': 'application/json' };
  const register = await fetch(`${cms}/admin/register-admin`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ ...admin, firstname: 'Check', lastname: 'Admin' }),
  });
  if (register.status !== 200) throw new Error(`POST /admin/register-admin answered ${register.status}`);
  const login = await fetch(`${cms}/admin/login`, { method: 'POST', headers: json, body: JSON.stringify(admin) });
  if (login.status !== 200) throw new Error(`POST /admin/login answered ${login.status}`);
  const token = (await login.json())?.data?.token;
  if (typeof token !== 'string') throw new Error('POST /admin/login answered no token');
  const last = await fetch(`${cms}/theme-picker/last-rebuild`, { headers: { authorization: `Bearer ${token}` } });
  const body = await last.text();
  if (last.status !== 200 || !lastRebuildSucceeded(body)) {
    throw new Error(`GET /theme-picker/last-rebuild answered ${last.status} and its last rebuild did not succeed`);
  }
  console.log('last-rebuild succeeded');
}

/** The dynamic demo: up, the CMS healthy, the frontend serving the first seeded article. */
async function checkDynamic(ctx) {
  const up = await ctx.compose(['up', '-d', 'frontend']);
  if (up.code !== 0) throw new Error(`docker compose up exited ${up.code}:\n${up.output.split('\n').slice(-40).join('\n')}`);
  await waitFor(
    'cms to be healthy',
    async () => {
      const ps = await ctx.compose(['ps', '--format', '{{.Service}} {{.Health}}', 'cms']);
      return ps.code === 0 && /^cms healthy$/m.test(ps.output) && (await status(`http://127.0.0.1:${ctx.ports.cms}/_health`)) === 204;
    },
    ctx.timeoutMs
  );
  console.log('cms / healthy');
  const url = `http://127.0.0.1:${ctx.ports.frontend}${FIRST_ARTICLE}`;
  await waitFor(`GET ${FIRST_ARTICLE} of the frontend to answer 200`, async () => (await status(url)) === 200, ctx.timeoutMs);
  console.log(`frontend ${FIRST_ARTICLE} 200`);
}

/** Runs the check; returns the exit code. */
async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' }, rebuilds: { type: 'string', default: '1' } } });
  const file = values.file ?? '';
  const missing = missingVariables(file, process.env);
  if (missing.length > 0) {
    console.error(missing.join('\n'));
    return 1;
  }
  if (!/^[1-9][0-9]*$/.test(values.rebuilds)) {
    console.error('--rebuilds must be a positive integer');
    return 1;
  }
  const dynamic = STACKS[file].kind === 'dynamic';
  const project = `demo-check-${randomBytes(4).toString('hex')}`;
  const ports = dynamic
    ? { cms: await freePort(), frontend: await freePort() }
    : { cms: await freePort(), site: await freePort() };
  const dir = await mkdtemp(join(tmpdir(), 'demo-stack-check-'));
  const overridePath = join(dir, 'ports.yml');
  await writeFile(
    overridePath,
    portsOverride(
      dynamic
        ? { cms: [[ports.cms, 1337], [ports.frontend, 8080]] }
        : { cms: [[ports.cms, 1337]], site: [[ports.site, 8080]] }
    )
  );
  const base = ['compose', '-p', project, '-f', join(ROOT, file), '-f', overridePath];
  const ctx = { ports, timeoutMs: timeoutSeconds() * 1000, compose: (args) => docker([...base, ...args]) };

  let cleaning;
  const cleanup = () =>
    (cleaning ??= (async () => {
      try {
        const down = await docker([...base, 'down', '-v', '--remove-orphans'], { cleanup: true });
        if (down.code !== 0) console.error(`docker compose down exited ${down.code}:\n${down.output}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    })());
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      console.error(`${signal}: stopping and cleaning up`);
      for (const child of inFlight) child.kill('SIGTERM');
      try {
        await cleanup();
      } finally {
        process.exit(128 + constants.signals[signal]);
      }
    });
  }

  let code = 0;
  try {
    console.log(`project ${project}, ${file}`);
    if (dynamic) await checkDynamic(ctx);
    else await checkStatic(ctx, Number(values.rebuilds));
  } catch (error) {
    code = 1;
    console.error(error.message);
    try {
      console.log((await ctx.compose(['logs', '--no-color'])).output);
    } catch (logError) {
      console.error(`Could not read the logs: ${logError.message}`);
    }
  } finally {
    await cleanup();
  }
  return code;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
