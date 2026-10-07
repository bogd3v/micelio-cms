// Fails if the repository enables or imports Strapi Enterprise (EE) code, which is not AGPL-compatible (bogd3v/micelio-cms#96).
// EE code ships inside @strapi/* packages but stays inactive without a license key; see THIRD-PARTY.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SELF = [
  'scripts/check-no-ee.mjs',
  'THIRD-PARTY.md',
  'scripts/licenses-allow.json',
  'package-lock.json',
];
const RULES = [
  {
    pattern: /STRAPI_LICENSE/,
    message: 'sets or reads STRAPI_LICENSE (Strapi Enterprise license key)',
  },
  {
    pattern: /['"]@strapi\/(review-workflows|content-releases)['"/]/,
    message: 'imports a Strapi Enterprise package',
  },
  { pattern: /['"]@strapi\/[^'"]+\/ee(\/|['"])/, message: 'imports Strapi code under ee/' },
];

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(
    (f) =>
      f &&
      !SELF.includes(f) &&
      /\.(m?[jt]sx?|json|ya?ml|sh|env\.example)$|(^|\/)(Dockerfile|\.env\.example)$/.test(f)
  );

const failures = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) failures.push(`${file}:${i + 1} ${rule.message}`);
    }
  });
}

if (failures.length) {
  for (const f of failures) console.error(`error: ${f}`);
  console.error('Strapi Enterprise code must stay disabled: see THIRD-PARTY.md.');
  process.exit(1);
}
console.log(`No Strapi Enterprise code enabled (${files.length} files checked).`);
