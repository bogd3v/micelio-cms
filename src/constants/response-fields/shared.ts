import type { Shape } from './types';

/**
 * Objects that several routes return, by name. `media-card` is a file with
 * the fields the frontend asks for; `media-file` is a whole file row, as an
 * unrestricted populate returns it.
 */
export const SHARED_SHAPES: Record<string, Shape> = {
  pagination: {
    page: 'required',
    pageSize: 'required',
    pageCount: 'required',
    total: 'required',
  },
};
