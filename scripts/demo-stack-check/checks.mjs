// The pure parts of the demo stack check (bogd3v/micelio-cms#535): which variables a compose file needs, which
// builder lines mean it could not read `build.env` or write `demo-site`, whether the admin reads a rebuild that
// succeeded, and the compose override that moves the published ports. Tested in tests/demo-stack-check.test.js.
// docs/architecture/testing.md ("Demo stack check").

/**
 * The compose files the check runs, with the variables each needs and the services whose ports the
 * check publishes. `compose.demo.yml` is the dynamic demo (the frontend shares the `cms` network namespace);
 * the other two are the static and landing stacks, where `site` serves the generated files.
 */
export const STACKS = {
  'compose.static.yml': { kind: 'static', needs: ['MICELIO_CMS_IMAGE', 'MICELIO_BUILDER_IMAGE'] },
  'compose.landing.yml': { kind: 'static', needs: ['MICELIO_CMS_IMAGE', 'MICELIO_BUILDER_IMAGE'] },
  'compose.demo.yml': { kind: 'dynamic', needs: ['MICELIO_CMS_IMAGE', 'MICELIO_IMAGE'] },
};

/**
 * One line for each variable the compose file needs that `env` does not set (or sets empty), each naming
 * the variable; an empty list when none is missing. A file the check does not know gives one line saying so.
 */
export function missingVariables(file, env) {
  const stack = STACKS[file];
  if (!stack) return [`${file} is not a compose file this check runs (${Object.keys(STACKS).join(', ')})`];
  return stack.needs.filter((name) => !env[name]).map((name) => `${name} is not set`);
}

/** The lines of a builder's output that say it could not read `build.env` or could not write `demo-site`. */
export function builderFailureLines(output) {
  return String(output)
    .split('\n')
    .filter((line) => /are required|\/out is not writable|Permission denied/.test(line));
}

/** True only when `body` is the JSON of `GET /theme-picker/last-rebuild` and its last rebuild succeeded. */
export function lastRebuildSucceeded(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false; // not JSON: the admin did not answer as the route does
  }
  return parsed?.data?.lastRebuild?.status === 'succeeded';
}

/**
 * The compose override that changes only `ports:` of the services given, each as `{ service: [[hostPort, containerPort], ...] }`,
 * bound to 127.0.0.1 and replacing (`!override`) the file's own, so the check runs beside other stacks.
 */
export function portsOverride(services) {
  const lines = ['services:'];
  for (const [service, ports] of Object.entries(services)) {
    lines.push(`  ${service}:`, '    ports: !override');
    for (const [host, container] of ports) lines.push(`      - '127.0.0.1:${host}:${container}'`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * How `docker` is spawned. The cleanup's commands (`down -v --remove-orphans`) run `detached`, in a process group of their
 * own, so the Ctrl-C of a terminal, which reaches the whole foreground group, cannot interrupt them and leave volumes
 * behind; the commands of the check itself stay in the script's group and die with it.
 */
export function spawnOptions({ cleanup }) {
  return { detached: cleanup, stdio: ['ignore', 'pipe', 'pipe'] };
}
