type Options = Record<string, unknown>;

function isObject(value: unknown): value is Options {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Levels an options object adds below its relation: its fragments (`on`) and its `populate`. */
function optionsDepth(options: unknown): number {
  if (!isObject(options)) return 0;
  const fragments = isObject(options.on) ? Object.values(options.on) : [];
  return Math.max(populateDepth(options.populate), 0, ...fragments.map(optionsDepth));
}

/**
 * How many relation levels a `populate` query parameter asks for.
 *
 * @remarks
 * Counts every key of the object form, every segment of a dotted string
 * (`a.b.c` is 3) and `*` or `true` as one level. A dynamic zone fragment
 * (`on`) adds none: `sections` with a fragment that populates `items` that
 * populates `icon` is 3. Strapi applies no depth limit of its own.
 *
 * @param populate - The parsed `populate` value of a query: a string, an array or an object.
 */
export function populateDepth(populate: unknown): number {
  if (typeof populate === 'string') {
    return Math.max(...populate.split(',').map((path) => path.split('.').length));
  }
  if (populate === true) return 1;
  if (Array.isArray(populate)) return Math.max(0, ...populate.map(populateDepth));
  if (!isObject(populate)) return 0;
  return Math.max(0, ...Object.values(populate).map((options) => 1 + optionsDepth(options)));
}
