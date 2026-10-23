type Options = Record<string, unknown>

function isObject(value: unknown): value is Options {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** Levels an options object adds below its relation: its fragments (`on`) and its `populate`. */
function optionsDepth(options: unknown): number {
  if (!isObject(options)) return 0
  const fragments = isObject(options.on) ? Object.values(options.on) : []
  return Math.max(populateDepth(options.populate), 0, ...fragments.map(optionsDepth))
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
    return Math.max(...populate.split(',').map((path) => path.split('.').length))
  }
  if (populate === true) return 1
  if (Array.isArray(populate)) return Math.max(0, ...populate.map(populateDepth))
  if (!isObject(populate)) return 0
  return Math.max(0, ...Object.values(populate).map((options) => 1 + optionsDepth(options)))
}

/** Operators that combine conditions without adding a relation level. */
const LOGICAL_OPERATORS = new Set(['$and', '$or', '$not'])

/**
 * How many relation levels a `filters` query parameter walks.
 *
 * @remarks
 * Every key that is not an operator is a level (`category.slug` is 2). `$and`,
 * `$or` and `$not` add none and their conditions are walked; comparison
 * operators (`$eq`, `$in`, `$containsi`) end the walk. An array under a
 * relation (`filters[a][0][b]`) adds none. Strapi applies no depth limit of its own.
 *
 * @param filters - The parsed `filters` value of a query.
 */
export function filtersDepth(filters: unknown): number {
  if (Array.isArray(filters)) return Math.max(0, ...filters.map(filtersDepth))
  if (!isObject(filters)) return 0
  return Math.max(
    0,
    ...Object.entries(filters).map(([key, value]) => {
      if (LOGICAL_OPERATORS.has(key)) return filtersDepth(value)
      if (key.startsWith('$')) return 0
      return 1 + filtersDepth(value)
    })
  )
}

/**
 * How many relation levels a `sort` query parameter walks.
 *
 * @remarks
 * Counts the dotted segments of a path, ignoring the `:asc` or `:desc`
 * suffix (`category.articles.name:asc` is 3), and the nested keys of the object form.
 *
 * @param sort - The parsed `sort` value of a query: a string, an array or an object.
 */
export function sortDepth(sort: unknown): number {
  if (typeof sort === 'string') {
    return Math.max(0, ...sort.split(',').map((item) => item.split(':')[0].split('.').length))
  }
  if (Array.isArray(sort)) return Math.max(0, ...sort.map(sortDepth))
  if (!isObject(sort)) return 0
  return Math.max(
    0,
    ...Object.values(sort).map((value) => 1 + (isObject(value) ? sortDepth(value) : 0))
  )
}
