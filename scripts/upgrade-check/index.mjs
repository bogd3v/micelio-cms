// A scripted upgrade check (bogd3v/micelio-cms#369): starts a released image on PostgreSQL with the
// demo content, counts rows and permissions, restarts the same database under the image to test,
// counts again and fails when a count fell. docs/architecture/testing.md ("Upgrade check").
//
//   npm run test:upgrade [-- --allow-drop <name>]...
//
// UPGRADE_FROM_IMAGE (default ghcr.io/bogd3v/micelio-cms:0.5.0), UPGRADE_TO_IMAGE (default: a
// `docker build` of this working tree), CHECK_KEEP=1 keeps the stack, CHECK_TIMEOUT_SECONDS (300)
// bounds each wait. Needs Docker; no secret, token or email is printed.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compareCounts, contentTablesSql, formatTable, LIST_TABLES_SQL, parseCounts, PERMISSIONS_SQL, readCollectionNames, trackedTables } from './counts.mjs';
import { docker, interrupt, removeRun, runLabel, waitFor } from './docker.mjs';

/** Tables that the demo seed fills in the released image; if one is empty before the upgrade, the check proves nothing. */
const SEEDED = ['abouts', 'articles', 'authors', 'categories', 'pages', 'tags'];

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_FROM = 'ghcr.io/bogd3v/micelio-cms:0.5.0';
const POSTGRES_IMAGE = 'postgres:18-alpine';
const DB_NAME = 'strapi';
const DB_USER = 'strapi';
/** Loads the generated secrets, then starts as the image does (the same entrypoint as compose.demo.yml). */
const CMS_START = 'set -a && . /secrets/cms.env && set +a && exec docker-entrypoint.sh node server.js';

const log = (message) => console.log(`[upgrade-check] ${message}`);

async function startPostgres(ctx) {
  await docker([
    'run', '-d', '--name', ctx.db, '--network', ctx.network, ...ctx.labelArgs,
    '-e', `POSTGRES_DB=${DB_NAME}`, '-e', `POSTGRES_USER=${DB_USER}`, '-e', 'POSTGRES_PASSWORD_FILE=/secrets/db_password',
    '-v', `${ctx.secrets}:/secrets:ro`, '-v', `${ctx.dbData}:/var/lib/postgresql`,
    POSTGRES_IMAGE,
  ]);
  await waitFor('PostgreSQL to accept connections', async () => {
    try {
      await docker(['exec', ctx.db, 'pg_isready', '-h', '127.0.0.1', '-U', DB_USER, '-d', DB_NAME]);
      return true;
    } catch {
      return false; // not ready yet: the next poll asks again
    }
  }, ctx);
}

async function startCms(ctx, image) {
  const name = `${ctx.id}-cms`;
  await docker([
    'run', '-d', '--name', name, '--network', ctx.network, ...ctx.labelArgs, '-p', '127.0.0.1::1337',
    '-v', `${ctx.secrets}:/secrets:ro`, '-v', `${ctx.uploads}:/app/public/uploads`,
    '-e', 'URL=http://localhost:1337', '-e', 'FRONTEND_URL=http://localhost:3000', '-e', 'MICELIO_DEMO=true',
    '-e', 'DATABASE_CLIENT=postgres', '-e', `DATABASE_HOST=${ctx.db}`, '-e', 'DATABASE_PORT=5432',
    '-e', `DATABASE_NAME=${DB_NAME}`, '-e', `DATABASE_USERNAME=${DB_USER}`, '-e', 'DATABASE_SSL=false', '-e', 'TRUST_PROXY=false',
    '--entrypoint', '/sbin/tini', image, '--', 'sh', '-c', CMS_START,
  ]);
  const hostPort = (await docker(['port', name, '1337/tcp'])).split('\n')[0];
  const url = `http://${hostPort}/_health`;
  await waitFor(`GET /_health to answer 204 from ${image}`, async () => {
    const state = await docker(['inspect', '-f', '{{.State.Running}}', name]);
    if (state !== 'true') throw new Error(`The container of ${image} stopped before it was healthy; rerun with CHECK_KEEP=1 and read its logs`);
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status === 204;
    } catch {
      return false; // not listening yet: the next poll asks again
    }
  }, ctx);
  return name;
}

async function psql(ctx, sql) {
  return docker(['exec', '-i', ctx.db, 'psql', '-U', DB_USER, '-d', DB_NAME, '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql });
}

async function countAll(ctx) {
  const tables = parseCounts(await psql(ctx, contentTablesSql(ctx.tracked, ctx.collections)));
  const permissions = parseCounts(await psql(ctx, PERMISSIONS_SQL));
  return new Map([...tables, ...permissions]);
}

async function ensureImage(image) {
  try {
    await docker(['image', 'inspect', image]);
  } catch {
    log(`pulling ${image}`);
    await docker(['pull', '-q', image]);
  }
}

/** CHECK_TIMEOUT_SECONDS as a positive integer (default 300); anything else stops the run, since a NaN deadline never expires. */
function timeoutSeconds() {
  const raw = process.env.CHECK_TIMEOUT_SECONDS ?? '300';
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error('CHECK_TIMEOUT_SECONDS must be a positive integer');
  return Number(raw);
}

async function main() {
  const { values } = parseArgs({ options: { 'allow-drop': { type: 'string', multiple: true, default: [] } } });
  const allowed = values['allow-drop'];
  const id = `upgrade-check-${randomBytes(4).toString('hex')}`;
  const { label, labelArgs } = runLabel(id);
  const ctx = {
    id, labelArgs, db: `${id}-db`, network: `${id}-net`, secrets: `${id}-secrets`, dbData: `${id}-db`, uploads: `${id}-uploads`,
    timeoutMs: timeoutSeconds() * 1000,
    collections: readCollectionNames(ROOT),
  };
  const from = process.env.UPGRADE_FROM_IMAGE || DEFAULT_FROM;
  let to = process.env.UPGRADE_TO_IMAGE;
  const builtImages = [];
  let cleaning;
  const cleanup = () => (cleaning ??= removeAll());
  const removeAll = async () => {
    if (process.env.CHECK_KEEP === '1') {
      log(`CHECK_KEEP=1: kept. Remove with: docker ps -aq --filter label=${label} | xargs -r docker rm -fv; docker volume ls -q --filter label=${label} | xargs -r docker volume rm; docker network ls -q --filter label=${label} | xargs -r docker network rm${builtImages.map((image) => `; docker rmi ${image}`).join('')}`);
      return;
    }
    const left = await removeRun(label);
    if (left.length > 0) throw new Error(`Could not remove, label ${label}: ${left.join(', ')}`);
    log('removed every container, volume, network and image of this run');
  };
  // Before the first Docker command: stop what is in flight, then remove everything by label.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      log(`${signal}: stopping and cleaning up`);
      try {
        await interrupt();
        await cleanup();
      } catch (error) {
        console.error(`[upgrade-check] cleanup failed: ${error.message}`);
      } finally {
        process.exit(128 + constants.signals[signal]);
      }
    });
  }

  try {
    if (!to) {
      to = `micelio-cms-upgrade-check:${id}`;
      log('building the image of this working tree (UPGRADE_TO_IMAGE is not set)');
      await docker(['build', '-q', '--target', 'production', ...labelArgs, '-t', to, ROOT]);
      builtImages.push(to);
    }
    log(`from ${from} to ${to}; run ${id}; ${ctx.collections.length} content tables`);
    await ensureImage(from);
    await ensureImage(to);

    await docker(['network', 'create', ...labelArgs, ctx.network]);
    for (const volume of [ctx.secrets, ctx.dbData, ctx.uploads]) await docker(['volume', 'create', ...labelArgs, volume]);
    // Same generator as compose.demo.yml's `init`; its output only names the files it wrote.
    await docker(['run', '--rm', ...labelArgs, '--user', '0', '--entrypoint', 'node', '-v', `${ctx.secrets}:/secrets`, from, 'scripts/demo-secrets.js', '/secrets']);
    await startPostgres(ctx);

    log(`starting ${from} with MICELIO_DEMO=true`);
    const first = await startCms(ctx, from);
    // Every table the released image created, not only those of this tree's schemas: a content type the new code retires stays counted.
    ctx.tracked = trackedTables((await psql(ctx, LIST_TABLES_SQL)).split('\n').filter(Boolean));
    log('counting rows before the upgrade');
    const before = await countAll(ctx);
    const empty = SEEDED.filter((name) => !before.get(name));
    if (empty.length > 0) throw new Error(`The released image left no rows in: ${empty.join(', ')}; the demo seed did not run, so the check would prove nothing`);
    await docker(['stop', '-t', '30', first]);
    await docker(['rm', first]);

    log(`starting ${to} on the same database`);
    await startCms(ctx, to);
    log('counting rows after the upgrade');
    const after = await countAll(ctx);

    const rows = compareCounts(before, after, allowed);
    console.log(`\n${formatTable(rows)}\n`);
    if (allowed.length > 0) log(`allowed drops: ${allowed.join(', ')}`);
    for (const name of allowed) if (!rows.some((row) => row.name === name)) log(`warning: --allow-drop ${name} matches no row`);
    const dropped = rows.filter((row) => row.dropped).map((row) => row.name);
    if (dropped.length > 0) {
      console.error(`[upgrade-check] FAILED: ${dropped.length} count(s) decreased: ${dropped.join(', ')}`);
      process.exitCode = 1;
    } else {
      log('OK: no count decreased');
    }
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error(`[upgrade-check] cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`[upgrade-check] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
