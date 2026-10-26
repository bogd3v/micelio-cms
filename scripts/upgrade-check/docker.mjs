// Docker plumbing of the upgrade check: every container, volume, network and image it creates
// carries one label, so cleanup removes only its own (bogd3v/micelio-cms#369).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** The `docker` commands in flight, so an interruption can stop them and wait for the daemon to settle. */
const inFlight = new Set();
let interrupted = false;

/**
 * Stops the run: no new `docker` command starts (except the cleanup's own), the ones in flight are
 * killed and awaited. The daemon may still finish a `create` it already received, which is why
 * `removeRun` looks again until nothing appears.
 */
export async function interrupt() {
  interrupted = true;
  for (const child of inFlight) child.kill('SIGTERM');
  await Promise.allSettled([...inFlight].map((child) => child.done));
}

/** Resolves when the command ends, whatever its result: the caller of `docker` reports the failure. */
async function settled(done) {
  try {
    await done;
  } catch {
    // the awaiting caller of `docker` gets the error
  }
}

/**
 * Starts `docker` and collects its output. `detached` gives the child its own process group (`execFile`
 * ignores that option), so a signal sent to node's group, such as the Ctrl-C of a terminal, does not reach it.
 * `done` rejects on a non-zero exit with `code`, `signal` and `stderr` on the error.
 */
function start(args, { input, detached }) {
  const child = spawn('docker', args, { detached, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = [];
  const err = [];
  child.stdout.on('data', (chunk) => out.push(chunk));
  child.stderr.on('data', (chunk) => err.push(chunk));
  // A child killed before it read its input closes the pipe; the exit code reports it.
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const result = { stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() };
      if (code === 0) resolve(result);
      else reject(Object.assign(new Error(`docker exited with ${code ?? signal}`), { ...result, code }));
    });
  });
  return { child, done };
}

/** Runs `docker` and returns trimmed stdout; the error names the failing subcommand and carries stderr, never the arguments. */
export async function docker(args, { input, cleanup = false } = {}) {
  if (interrupted && !cleanup) throw new Error('Interrupted');
  // The cleanup's commands run in their own process group, so the Ctrl-C of a terminal (sent to the whole foreground group) does not kill them.
  const { child, done } = start(args, { input, detached: cleanup });
  // The cleanup's own commands are never tracked, so an interruption cannot kill the cleanup.
  const tracked = cleanup ? null : { kill: (signal) => child.kill(signal), done: settled(done) };
  if (tracked) inFlight.add(tracked);
  try {
    return (await done).stdout.trim();
  } catch (error) {
    if (interrupted && !cleanup) throw new Error('Interrupted', { cause: error });
    const stderr = String(error.stderr ?? '').trim().split('\n').slice(-40).join('\n');
    throw new Error(`docker ${args[0]} failed (exit ${error.code}):\n${stderr}`, { cause: error });
  } finally {
    if (tracked) inFlight.delete(tracked);
  }
}

/** Polls `probe` until it returns a truthy value or `timeoutMs` passes; `describe` names what was awaited. */
export async function waitFor(describe, probe, { timeoutMs, intervalMs = 2000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${describe}`);
    await sleep(intervalMs);
  }
}

/** Labels one run's resources; `labelArgs` is the `--label` flag for any `docker create`-like command. */
export function runLabel(runId) {
  const label = `org.micelio.upgrade-check=${runId}`;
  return { label, labelArgs: ['--label', label] };
}

/** The first line of an error without its trailing colon: `docker ps failed (exit null)`. */
function firstLine(error) {
  return error.message.split('\n')[0].replace(/:$/, '');
}

/** Lists the ids of one kind of resource that carries the label, in any state. */
async function labelled(kind, filter) {
  return (await docker([...kind, ...filter], { cleanup: true })).split('\n').filter(Boolean);
}

/**
 * Removes every container (in any state), volume, network and image that carries the label, found by
 * the label and not by what the script recorded, and repeats until two passes in a row find nothing.
 * Returns what could not be removed (an empty list when clean).
 */
export async function removeRun(label) {
  const filter = ['--filter', `label=${label}`];
  const kinds = {
    container: ['ps', '-aq'],
    volume: ['volume', 'ls', '-q'],
    network: ['network', 'ls', '-q'],
    image: ['image', 'ls', '-q'],
  };
  const remove = {
    container: (ids) => ['rm', '-f', '-v', ...ids],
    volume: (ids) => ['volume', 'rm', '-f', ...ids],
    network: (ids) => ['network', 'rm', ...ids],
    image: (ids) => ['rmi', '-f', ...ids],
  };
  let left = [];
  let quiet = 0;
  for (let pass = 0; quiet < 2 && pass < 20; pass += 1) {
    left = [];
    for (const [name, kind] of Object.entries(kinds)) {
      try {
        const ids = [...new Set(await labelled(kind, filter))];
        if (ids.length === 0) continue;
        left.push(...ids.map((id) => `${name} ${id}`));
        await docker(remove[name](ids), { cleanup: true });
      } catch (error) {
        // a listing or removal that failed (daemon busy, resource in use, killed): the pass counts as not quiet and the next one retries it
        left.push(`${name} (${firstLine(error)})`);
      }
    }
    quiet = left.length === 0 ? quiet + 1 : 0;
    if (quiet < 2) await sleep(1000);
  }
  // What the last pass removed is gone: report what a final listing still finds.
  if (left.length === 0) return left;
  const rest = [];
  for (const [name, kind] of Object.entries(kinds)) {
    try {
      rest.push(...(await labelled(kind, filter)).map((id) => `${name} ${id}`));
    } catch (error) {
      rest.push(`${name} (${firstLine(error)})`);
    }
  }
  return rest;
}
