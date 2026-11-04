import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupStrapi, setupStrapi } from './strapi'

// What the admin reads of the builder's last run (#405): GET /theme-picker/last-rebuild, for the
// Super Admin only, from the file scripts/builder-last-run.sh wrote. Nothing waits on the builder.

const REFUSED = {
  code: 'theme-refused',
  rule: 'unknown',
  detail: null,
  httpStatus: null,
  seconds: null,
}
const UNKNOWN = { code: 'unknown', rule: null, detail: null, httpStatus: null, seconds: null }
const PASSWORD = 'Rebuild-status-1'
const BUILD_KEY = 'rebuild-status-build-0123456789abcdef0123456789abcd'
const SECRET = 'sk-live-0123456789abcdef-never-in-the-admin'
const SCRIPT = join(__dirname, '..', 'scripts', 'builder-last-run.sh')
const ROUTE = '/theme-picker/last-rebuild'
const REASON =
  'Static theme: the theme the site settings name ("does-not-exist") was not used (unknown): the registry does not list it'
const FAILED =
  'micelio-builder: the generation failed; /out keeps the site it held before. The reason is the first error above.'

describe('GET /theme-picker/last-rebuild', () => {
  const http = () => request(strapi.server.httpServer)
  const as = (token: string) => ({ Authorization: `Bearer ${token}` })
  const saved = { ...process.env }
  let dir: string
  let status: string
  /** The builder's output directory: it holds the site an earlier build left. */
  let out: string
  let counter = 0

  async function signInAs(code: string): Promise<string> {
    counter += 1
    const role = await strapi.db.query('admin::role').findOne({ where: { code } })
    const email = `rebuild-${counter}@example.test`
    await strapi.service('admin::user').create({
      email,
      password: PASSWORD,
      firstname: 'Rebuild',
      lastname: 'Tester',
      isActive: true,
      roles: [role.id],
    })
    const res = await http().post('/admin/login').send({ email, password: PASSWORD }).expect(200)
    return res.body.data.token ?? res.body.data.accessToken
  }
  /** Runs the real wrapper around a fake builder; resolves with its exit code. */
  function runBuilder(script: string, env: Record<string, string> = {}): Promise<number | null> {
    return new Promise((resolve) => {
      const child = spawn('sh', [SCRIPT, 'sh', '-c', script], {
        env: { PATH: process.env.PATH ?? '', REBUILD_STATUS_FILE: status, OUT_DIR: out, ...env },
        stdio: 'ignore',
      })
      child.once('close', resolve)
    })
  }
  const refuses = (lines: string[]) =>
    `${lines.map((line) => `echo ${JSON.stringify(line)} >&2`).join('\n')}\nexit 1`

  beforeAll(async () => {
    process.env.BUILD_API_TOKEN = BUILD_KEY
    dir = await mkdtemp(join(tmpdir(), 'rebuild-route-'))
    status = join(dir, 'last-run')
    out = join(dir, 'out')
    await mkdir(out)
    await writeFile(join(out, 'index.html'), '<h1>site</h1>')
    process.env.REBUILD_STATUS_FILE = status
    await setupStrapi()
  })
  afterAll(async () => {
    await cleanupStrapi()
    await rm(dir, { recursive: true, force: true })
    process.env = { ...saved }
  })
  afterEach(async () => {
    process.env.REBUILD_STATUS_FILE = status
    await rm(status, { force: true })
  })

  it('says the builder has not run before there is a file', async () => {
    const token = await signInAs('strapi-super-admin')
    const res = await http().get(ROUTE).set(as(token))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ configured: true, lastRebuild: null, unreadable: false })
  })

  it('says nothing is recorded when REBUILD_STATUS_FILE is not set', async () => {
    delete process.env.REBUILD_STATUS_FILE
    const token = await signInAs('strapi-super-admin')
    const res = await http().get(ROUTE).set(as(token))
    expect(res.body.data).toEqual({ configured: false, lastRebuild: null, unreadable: false })
  })

  it('shows why a rebuild failed and that the previous site is kept', async () => {
    expect(await runBuilder(refuses([`ERROR ${REASON}`, FAILED]))).toBe(1)
    const token = await signInAs('strapi-super-admin')
    const res = await http().get(ROUTE).set(as(token))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      configured: true,
      lastRebuild: {
        status: 'failed',
        finishedAt: expect.stringMatching(/Z$/),
        reasons: [REFUSED],
        previousSiteKept: true,
      },
      unreadable: false,
    })
  })

  it('does not claim a kept site after a failed first build', async () => {
    const empty = join(dir, 'empty-out')
    await mkdir(empty)
    expect(await runBuilder(refuses([REASON, FAILED]), { OUT_DIR: empty })).toBe(1)
    const token = await signInAs('strapi-super-admin')
    const res = await http().get(ROUTE).set(as(token))
    expect(res.body.data.lastRebuild).toMatchObject({
      status: 'failed',
      reasons: [REFUSED],
      previousSiteKept: false,
    })
  })

  it('says the record cannot be read, not that the builder has not run', async () => {
    await writeFile(status, 'not a status file\n')
    const token = await signInAs('strapi-super-admin')
    const res = await http().get(ROUTE).set(as(token))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ configured: true, lastRebuild: null, unreadable: true })
  })

  it('clears the failure when a later rebuild succeeds', async () => {
    await runBuilder(refuses([REASON, FAILED]))
    const token = await signInAs('strapi-super-admin')
    expect((await http().get(ROUTE).set(as(token))).body.data.lastRebuild.status).toBe('failed')
    expect(await runBuilder('echo ok')).toBe(0)
    const res = await http().get(ROUTE).set(as(token))
    expect(res.body.data.lastRebuild).toMatchObject({
      status: 'succeeded',
      reasons: [],
      previousSiteKept: false,
    })
  })

  it('never shows a secret of the builder environment, or a path or a variable of its output', async () => {
    await runBuilder(
      refuses([
        `Static theme: the settings could not be read with ${SECRET} from /app/.nuxt/x.mjs`,
        `NUXT_STRAPI_API_TOKEN=${SECRET}`,
        `Static theme: expected redacted ABC1234 from REGISTRY_CREDENTIAL`,
        `Static theme: the theme the site settings name ("redacted") was not used (unknown): x`,
        `micelio-builder: the generation failed; /out keeps the site it held before. ${SECRET}`,
      ]),
      {
        NUXT_STRAPI_API_TOKEN: SECRET,
        A_TOKEN: 'redacted',
        API_KEY: 'cted',
        REGISTRY_CREDENTIAL: 'ABC1234',
      }
    )
    // The file as another wrapper could have left it, to try the reader on its own: it shows
    // codes it parsed, not the builder's text
    const token = await signInAs('strapi-super-admin')
    const wrapped = await http().get(ROUTE).set(as(token))
    expect(JSON.stringify(wrapped.body)).not.toContain(SECRET)
    expect(JSON.stringify(wrapped.body)).not.toContain('/app/')
    expect(JSON.stringify(wrapped.body)).not.toContain('/out')
    expect(JSON.stringify(wrapped.body)).not.toContain('ABC1234')
    // The id between the quotes is a valid id, and still is not shown
    expect(wrapped.body.data.lastRebuild.reasons).toEqual([UNKNOWN, REFUSED])
    expect(JSON.stringify(wrapped.body)).not.toContain('redacted')

    await writeFile(
      status,
      [
        'exit=1',
        'finished=2026-11-03T10:00:00Z',
        `NUXT_STRAPI_API_TOKEN=${SECRET}`,
        `Static theme: token NUXT_STRAPI_API_TOKEN=${SECRET} at /run/secrets-build/build.env`,
        `Static theme: registry credential hunter2hunter2 at https://u:pw1@registry.test/x`,
        '',
      ].join('\n')
    )
    const raw = await http().get(ROUTE).set(as(token))
    expect(raw.body.data.lastRebuild.reasons).toEqual([UNKNOWN])
    expect(JSON.stringify(raw.body)).not.toContain(SECRET)
    expect(JSON.stringify(raw.body)).not.toContain('hunter2')
    expect(JSON.stringify(raw.body)).not.toContain('/run/secrets-build')
  })

  it('answers while the builder is running, with the run before', async () => {
    await runBuilder(refuses([REASON, FAILED]))
    const release = join(dir, 'release')
    const running = new Promise((resolve) => {
      spawn('sh', [SCRIPT, 'sh', '-c', `while [ ! -f ${release} ]; do sleep 0.05; done`], {
        env: { PATH: process.env.PATH ?? '', REBUILD_STATUS_FILE: status },
        stdio: 'ignore',
      }).once('close', resolve)
    })
    try {
      const token = await signInAs('strapi-super-admin')
      const res = await http().get(ROUTE).set(as(token))
      expect(res.status).toBe(200)
      expect(res.body.data.lastRebuild.status).toBe('failed')
    } finally {
      // Always let the fake builder end, or a failed expectation leaves it looping
      await writeFile(release, '')
      await running
      await rm(release, { force: true })
    }
  })

  it.each(['strapi-editor', 'strapi-author'])('refuses %s', async (code) => {
    await runBuilder(refuses([REASON, FAILED]))
    const token = await signInAs(code)
    const res = await http().get(ROUTE).set(as(token))
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('does-not-exist')
  })

  it('refuses a request with no session and the build API token', async () => {
    expect((await http().get(ROUTE)).status).toBe(401)
    expect((await http().get(ROUTE).set(as(BUILD_KEY))).status).toBe(401)
  })
})
