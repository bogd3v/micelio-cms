// Fails on production dependencies whose license is not compatible with AGPL-3.0 (issue #306).
// Dev dependencies are not distributed: they only warn. Exceptions: scripts/licenses-allow.json.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOWED = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'MPL-2.0',
  'CC0-1.0',
  'MIT-0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Zlib',
  'OFL-1.1',
  'WTFPL',
];
const ALLOWED_PREFIXES = ['LGPL-', 'GPL-3.0', 'AGPL-3.0'];
// GPL-2.0 only if "or later" (then GPL-3.0 applies); GPL-2.0-only fails.
const ALLOWED_GPL2 = ['GPL-2.0-or-later', 'GPL-2.0+'];

export function idAllowed(id) {
  if (ALLOWED_GPL2.includes(id)) return true;
  const name = id.replace(/\+$/, '');
  return ALLOWED.includes(name) || ALLOWED_PREFIXES.some((p) => name.startsWith(p));
}

// SPDX expression: OR passes if one side is allowed, AND needs all, `X WITH exc`
// is judged by X. Anything malformed (unknown token, unbalanced parens) fails.
export function evaluate(expr) {
  const tokens = expr.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  let malformed = false;
  const keyword = (t) => ['AND', 'OR', 'WITH'].includes(t?.toUpperCase());
  function parseOr() {
    let v = parseAnd();
    while (tokens[i]?.toUpperCase() === 'OR') {
      i++;
      const r = parseAnd();
      v = v || r;
    }
    return v;
  }
  function parseAnd() {
    let v = parseWith();
    while (tokens[i]?.toUpperCase() === 'AND') {
      i++;
      const r = parseWith();
      v = v && r;
    }
    return v;
  }
  function parseWith() {
    const v = parseAtom();
    if (tokens[i]?.toUpperCase() === 'WITH') {
      i++;
      const exception = tokens[i++];
      if (exception === undefined || exception === '(' || exception === ')' || keyword(exception))
        malformed = true;
    }
    return v;
  }
  function parseAtom() {
    const t = tokens[i++];
    if (t === '(') {
      const v = parseOr();
      if (tokens[i++] !== ')') malformed = true;
      return v;
    }
    if (t === undefined || t === ')' || keyword(t)) {
      malformed = true;
      return false;
    }
    return idAllowed(t);
  }
  const result = parseOr();
  return result && !malformed && i === tokens.length;
}

function licenseOf(meta) {
  const l = meta.license;
  if (!l) return null;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return `(${l.map((x) => x.type ?? x).join(' OR ')})`;
  return l.type ?? null;
}

function main() {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const exceptions = JSON.parse(
    readFileSync(new URL('./licenses-allow.json', import.meta.url), 'utf8')
  );
  const counts = {};
  const failures = [];
  const warnings = [];
  for (const [path, meta] of Object.entries(lock.packages)) {
    if (path === '') continue;
    const name = path.replace(/^.*node_modules\//, '');
    const license = licenseOf(meta);
    const key = `${name}@${meta.version}`;
    const dev = Boolean(meta.dev);
    counts[license ?? 'UNKNOWN'] = (counts[license ?? 'UNKNOWN'] ?? 0) + 1;
    if (license && evaluate(license)) continue;
    const exception = exceptions[name];
    if (exception?.reason) continue;
    const entry = `${key} (${license ?? 'no license field'})${dev ? ' [dev]' : ''}`;
    (dev ? warnings : failures).push(entry);
  }

  if (process.argv.includes('--summary')) console.log(counts);
  for (const w of [...new Set(warnings)]) console.warn(`warn: ${w}`);
  if (failures.length) {
    for (const f of [...new Set(failures)]) console.error(`error: ${f}`);
    console.error(
      'Add a reasoned exception to scripts/licenses-allow.json or remove the dependency.'
    );
    process.exit(1);
  }
  console.log('Licenses ok: every production dependency is AGPL-3.0 compatible.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
