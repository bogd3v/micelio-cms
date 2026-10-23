/**
 * Whether the frontend reads a field of a response: `required` fields are
 * documented and never removed; `surplus` fields are returned but the frontend
 * does not need them (ASVS V15.3.1, `docs/security/response-fields.md`).
 */
type FieldUse = 'required' | 'surplus'

/** An object field of a response: how it is used and what is inside. */
export interface NestedField {
  use: FieldUse
  /**
   * The keys of the object, or of each object when the value is a list: an
   * inline shape, or the name of one in `SHARED_SHAPES`.
   */
  of?: Shape | string
  /** For a list of components: the keys of each item by its `__component`. */
  variants?: Record<string, Shape>
}

/** One field: a leaf (a scalar or a JSON value) or an object that has its own keys. */
export type FieldSpec = FieldUse | NestedField

/** The exact set of keys one object of a response may carry, with the use of each. */
export interface Shape {
  [key: string]: FieldSpec
}

/** Who calls a route: the public role, the frontend token, the build token, an editor or any signed-in user. */
export type Caller = 'public' | 'frontend' | 'build' | 'editor' | 'user'

/** What a route's body looks like: one object, a bare list of objects, or a map from a document id to an object. */
type BodyKind = 'object' | 'list' | 'map'

/** A route of the content API that returns data, with the keys its response may carry. */
export interface ResponseRoute {
  /** Stable identifier, used in the documentation and in test names. */
  id: string
  method: 'GET' | 'POST' | 'PUT'
  /** Path with `:param` placeholders. */
  path: string
  /** What the route asks of the caller, as a sentence. */
  auth: string
  /** Who may call it and gets this shape. */
  callers: readonly Caller[]
  /** The file of micelio that reads the response; empty when no frontend caller was found. */
  reader: string
  /** Why a field stays, a caveat, or what the shape does not cover. */
  note: string
  /** Defaults to `object`. For `list` and `map`, `body` describes each item. */
  kind?: BodyKind
  /** The keys of the body, or of each item of a `list` or `map` body. A field whose `of` is `'self'` has the keys of the item it sits in. */
  body: Shape
}

/** A group of routes that share a content type or a plugin, as the documentation lists them. */
export interface ResponseSurface {
  /** Heading of the group in `docs/security/response-fields.md`. */
  title: string
  routes: readonly ResponseRoute[]
}
