import {
  RESPONSE_ROUTES,
  SHARED_SHAPES,
  type Caller,
  type FieldSpec,
  type NestedField,
  type ResponseRoute,
  type Shape,
} from '../../src/constants/response-fields';

// Reading `src/constants/response-fields` against real response bodies, and
// rendering it as `docs/security/response-fields.md` (ASVS V15.3.1).

/** Path of the body itself in a report. */
export const ROOT = '(body)';
const SELF = 'self';

/** One object of a response: where it sits, which keys it may have and, when it is shared, its name. */
export interface Level {
  path: string;
  shape: Shape;
  /** Set when the level is a named shared shape or `self`, left unexpanded. */
  ref?: string;
}

/** What `checkBodies` found. */
interface ShapeReport {
  /** `path.key` of every key returned that the constants do not list. */
  extra: string[];
  /** `path.key` of every required key that no body carries, where the object is returned. */
  missing: string[];
  /** Paths of listed objects that no body carries, so the seed or the call does not cover them. */
  unseen: string[];
}

/** The route with this id; throws when `src/constants/response-fields` has none. */
export function routeById(id: string): ResponseRoute {
  const route = RESPONSE_ROUTES.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`No route ${id} in src/constants/response-fields`);
  return route;
}

const isNested = (spec: FieldSpec): spec is NestedField => typeof spec !== 'string';

const join = (path: string, key: string) => (path === ROOT ? key : `${path}.${key}`);

function sharedShape(name: string): Shape {
  const shape = SHARED_SHAPES[name];
  if (!shape) throw new Error(`response-fields: no shared shape named "${name}"`);
  return shape;
}

/** The keys an `of` points to; `self` is the enclosing item. */
function resolveOf(of: Shape | string, item: Shape): Shape {
  if (of === SELF) return item;
  return typeof of === 'string' ? sharedShape(of) : of;
}

/**
 * The objects of a shape, depth first. With `expand` a named shared shape is
 * walked where it is used; without it, it is one level with `ref` set, and
 * `self` is never expanded.
 */
export function levelsOf(root: Shape, expand: boolean, path = ROOT, item: Shape = root): Level[] {
  const levels: Level[] = [{ path, shape: root }];
  for (const [key, spec] of Object.entries(root)) {
    if (!isNested(spec)) continue;
    const child = join(path, key);
    if (spec.variants) {
      for (const [component, variant] of Object.entries(spec.variants)) {
        levels.push(...levelsOf(variant, expand, `${child}[${component}]`, item));
      }
    }
    if (spec.of === undefined) continue;
    if (spec.of === SELF) {
      levels.push({ path: child, shape: item, ref: SELF });
    } else if (typeof spec.of === 'string') {
      if (expand) levels.push(...levelsOf(sharedShape(spec.of), expand, child, item));
      else levels.push({ path: child, shape: sharedShape(spec.of), ref: spec.of });
    } else {
      levels.push(...levelsOf(spec.of, expand, child, item));
    }
  }
  return levels;
}

/** How many keys of a shape are `required` and how many `surplus`. */
function countUses(shape: Shape): { required: number; surplus: number } {
  const uses = Object.values(shape).map((spec) => (isNested(spec) ? spec.use : spec));
  return {
    required: uses.filter((use) => use === 'required').length,
    surplus: uses.filter((use) => use === 'surplus').length,
  };
}

/** Required and surplus keys of a route over every object it returns, shared shapes expanded. */
export function routeCounts(route: ResponseRoute): { required: number; surplus: number } {
  const totals = { required: 0, surplus: 0 };
  for (const level of levelsOf(route.body, true)) {
    if (level.ref) continue;
    const counts = countUses(level.shape);
    totals.required += counts.required;
    totals.surplus += counts.surplus;
  }
  return totals;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Compares response bodies with a route's shape. `extra` and `missing` are
 * the real findings; `unseen` is what keeps the shape honest, so it lists
 * nothing that a fully seeded instance does not return.
 */
export function checkBodies(route: ResponseRoute, bodies: unknown[]): ShapeReport {
  const seen = new Map<string, Set<string>>();
  const declared = new Map<string, Shape>();
  const extra = new Set<string>();

  const visit = (value: unknown, shape: Shape, path: string, item: Shape): void => {
    if (Array.isArray(value)) {
      for (const element of value) visit(element, shape, path, item);
      return;
    }
    if (!isObject(value)) return;
    declared.set(path, shape);
    const keys = seen.get(path) ?? new Set<string>();
    seen.set(path, keys);
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      const spec = shape[key];
      if (spec === undefined) {
        extra.add(join(path, key));
        continue;
      }
      if (!isNested(spec)) continue;
      const childPath = join(path, key);
      if (spec.variants) {
        for (const element of Array.isArray(child) ? child : [child]) {
          if (!isObject(element)) continue;
          const component = String(element.__component);
          const variant = spec.variants[component];
          if (variant) visit(element, variant, `${childPath}[${component}]`, item);
          else extra.add(`${childPath}[${component}]`);
        }
      } else if (spec.of !== undefined) {
        visit(child, resolveOf(spec.of, item), childPath, item);
      }
    }
  };

  for (const body of bodies) {
    if (route.kind === 'list') visit(body, route.body, ROOT, route.body);
    else if (route.kind === 'map' && isObject(body)) {
      for (const entry of Object.values(body)) visit(entry, route.body, ROOT, route.body);
    } else visit(body, route.body, ROOT, route.body);
  }

  const missing: string[] = [];
  for (const [path, shape] of declared) {
    for (const [key, spec] of Object.entries(shape)) {
      const use = isNested(spec) ? spec.use : spec;
      if (use === 'required' && !seen.get(path)?.has(key)) missing.push(join(path, key));
    }
  }
  const unseen = levelsOf(route.body, true)
    .filter((level) => !level.ref && !seen.has(level.path))
    .map((level) => level.path);
  return { extra: [...extra].sort(), missing: missing.sort(), unseen };
}

/** The command that regenerates the document after the constants change. */
export const DOC_COMMAND =
  'UPDATE_RESPONSE_FIELDS_DOC=1 npx jest tests/response-fields-docs.test.ts (npm run docs:response-fields)';

const exercised = new Set<string>();

/**
 * Throws, naming the route and the fields, when a body carries a key the
 * constants do not list, when a required key is missing or when a listed
 * object is never returned. Remembers that the route was read as `caller`.
 */
export function assertShape(route: ResponseRoute, caller: Caller, bodies: unknown[]): void {
  exercised.add(`${route.id} as ${caller}`);
  const { extra, missing, unseen } = checkBodies(route, bodies);
  const problems = [
    ...extra.map((field) => `"${field}" is returned but is not listed`),
    ...missing.map((field) => `required "${field}" is not returned`),
    ...unseen.map((path) => `"${path}" is listed but never returned`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `${route.id} as ${caller}: ${problems.join('; ')}. If the response is right, change src/constants/response-fields/ and regenerate the document with ${DOC_COMMAND}`
    );
  }
}

/** The `route as caller` pairs of `routeIds` that no `assertShape` call of this suite has read. */
export function unexercisedCallers(routeIds: readonly string[]): string[] {
  return routeIds.flatMap((id) =>
    routeById(id)
      .callers.map((caller) => `${id} as ${caller}`)
      .filter((pair) => !exercised.has(pair))
  );
}
