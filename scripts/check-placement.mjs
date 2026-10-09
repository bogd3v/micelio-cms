// Fails if a type or constant declared outside the shared places is imported by two or more files.
// The rule is "Where types and constants live" in docs/engineering-standard.md (bogd3v/micelio-cms#117).
//
// A constant is an exported `const` whose initializer is not an arrow or function expression;
// functions and classes are logic and are not checked.
// Known limits: an import through a barrel (`export { X } from`, `export *`) is credited to the
// barrel, not to the file that declares `X`; `import * as ns` and `import('./x').T` are not
// followed. `src/` has none of these today; a barrel would need this script to follow it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** Folders that are self-contained on purpose: they keep their own copies. */
const EXEMPT = ['src/migrations/', 'src/plugins/fediverse/'];
/** Folders where a shared declaration belongs. */
const SHARED_FOLDERS = ['src/types/', 'src/constants/'];
/** File names that hold the shared declarations of one feature folder. */
const SHARED_FILES = new Set(['types.ts', 'constants.ts']);
/** How many files must import a declaration before it counts as shared. */
const SHARED_FROM = 2;

const toPosix = (path) => path.split(sep).join('/');

function listSources(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });
}

const isExported = (node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const isFunctionLike = (node) =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** Types and constants a source file exports; functions and classes are logic, not shared data. */
function declarationsOf(source) {
  const found = [];
  const add = (name, node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({ name, line: line + 1 });
  };
  const locals = new Map();
  for (const node of source.statements) {
    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      locals.set(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && !isFunctionLike(decl.initializer)) {
          locals.set(decl.name.text, decl);
        }
      }
    }
  }
  for (const node of source.statements) {
    // `export { A, B }` and `export type { A }` without a source name local declarations.
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause) {
      if (!('elements' in node.exportClause)) continue;
      for (const element of node.exportClause.elements) {
        const local = locals.get((element.propertyName ?? element.name).text);
        if (local) add(element.name.text, local);
      }
      continue;
    }
    if (!isExported(node)) continue;
    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      add(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && !isFunctionLike(decl.initializer)) {
          add(decl.name.text, decl);
        }
      }
    }
  }
  return found;
}

function resolveImport(from, specifier, files) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier.replace(/\.[jt]s$/, ''));
  return [`${base}.ts`, join(base, 'index.ts')].find((candidate) => files.has(candidate)) ?? null;
}

/** `[file, name]` pairs a source file imports from the other files of the project. */
function importsOf(path, source, files) {
  const imported = [];
  for (const node of source.statements) {
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const target = resolveImport(path, node.moduleSpecifier.text, files);
    if (!target) continue;
    const clause = ts.isImportDeclaration(node)
      ? node.importClause?.namedBindings
      : node.exportClause;
    if (!clause || !('elements' in clause)) continue;
    for (const element of clause.elements) {
      imported.push([target, (element.propertyName ?? element.name).text]);
    }
  }
  return imported;
}

/**
 * Types and constants declared outside the shared places that two or more files import.
 *
 * @param root - The repository root, which holds `src/`.
 * @returns One entry per declaration, ordered by file and line.
 */
export function findMisplaced(root) {
  const rel = (path) => toPosix(relative(root, path));
  const exempt = (path) => EXEMPT.some((folder) => rel(path).startsWith(folder));
  const files = new Set(listSources(join(root, 'src')));
  const sources = new Map();
  for (const path of files) {
    sources.set(
      path,
      ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    );
  }

  const importers = new Map();
  for (const [path, source] of sources) {
    if (exempt(path)) continue;
    for (const [target, name] of importsOf(path, source, files)) {
      const key = `${target}\0${name}`;
      importers.set(key, (importers.get(key) ?? new Set()).add(path));
    }
  }

  const misplaced = [];
  for (const [path, source] of sources) {
    const file = rel(path);
    const isShared =
      exempt(path) ||
      SHARED_FOLDERS.some((folder) => file.startsWith(folder)) ||
      SHARED_FILES.has(file.slice(file.lastIndexOf('/') + 1));
    if (isShared) continue;
    for (const { name, line } of declarationsOf(source)) {
      const count = importers.get(`${path}\0${name}`)?.size ?? 0;
      if (count >= SHARED_FROM) misplaced.push({ file, line, name, importers: count });
    }
  }
  return misplaced.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// Not `import.meta.url`: Jest loads this file as CommonJS.
if (process.argv[1]?.endsWith('check-placement.mjs')) {
  const misplaced = findMisplaced(process.cwd());
  for (const { file, line, name, importers } of misplaced) {
    console.error(
      `${file}:${line} ${name} is imported by ${importers} files; move it to src/types/, src/constants/ or a types.ts / constants.ts next to its feature`
    );
  }
  if (misplaced.length > 0) process.exit(1);
  console.log('placement ok');
}
