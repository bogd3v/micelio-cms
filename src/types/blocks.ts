/**
 * Shapes of the article `blocks` dynamic zone, as far as the checks and
 * transforms that read it need them. Every field is optional: a block only
 * carries the ones its component declares.
 */

/** Attribution of an image: its license, author and the pages that prove them. */
export interface ImageCredit {
  license?: string | null;
  author?: string | null;
  authorUrl?: string | null;
  sourceUrl?: string | null;
  licenseUrl?: string | null;
}

/** A block of the article body; which fields are filled depends on `__component`. */
export interface BodyBlock {
  __component?: string;
  /** `shared.rich-text` and `shared.quote`. */
  body?: string | null;
  /** `shared.quote`. */
  title?: string | null;
  /** `shared.media` and `shared.playground`. */
  caption?: string | null;
  /** `shared.media`. */
  credit?: ImageCredit | null;
  /** `shared.slider`. */
  items?: { credit?: ImageCredit | null }[] | null;
}
