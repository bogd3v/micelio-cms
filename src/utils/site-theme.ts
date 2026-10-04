/**
 * Checks for `site.theme` in the site settings that the schema does not
 * enforce. Formats (slugs, `#RRGGBB`, the font list) are validated by the
 * component schemas; whether the theme and its modes exist, and the accent's
 * contrast, are resolved by the frontend (micelio ADR 0005, section 8).
 */

import { errors } from '@strapi/utils';

const OVERRIDE_FIELDS = ['mode', 'color'] as const;

function reject(index: number, field: string, message: string): never {
  throw new errors.ValidationError(message, {
    errors: [
      {
        path: ['theme', 'accentOverrides', String(index), field],
        message,
        name: 'ValidationError',
      },
    ],
  });
}

/**
 * Rejects accent overrides without a mode or a color, which Strapi lets
 * through because it does not apply `required` inside a component nested in
 * another, and a list that names the same mode twice, since Strapi has no
 * uniqueness check inside a repeatable component and the frontend would have
 * to pick one of the two accents.
 */
export function assertAccentOverridesValid(data: Record<string, unknown>): void {
  const theme = data.theme as { accentOverrides?: unknown } | null | undefined;
  const overrides = theme?.accentOverrides;
  if (!Array.isArray(overrides)) return;

  const seen = new Set<string>();
  (overrides as Record<string, unknown>[]).forEach((override, index) => {
    for (const field of OVERRIDE_FIELDS) {
      const value = override?.[field];
      if (typeof value !== 'string' || value.trim() === '') {
        reject(index, field, `Accent override ${index} needs a ${field}`);
      }
    }
    const mode = override.mode as string;
    if (seen.has(mode)) {
      reject(index, 'mode', `The mode "${mode}" has more than one accent override`);
    }
    seen.add(mode);
  });
}
