/**
 * Checks on a page's sections that the component schemas cannot express.
 * Required fields, variants, link formats and item counts are schema rules,
 * which Strapi applies on publish (drafts may be incomplete).
 */

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const FILE_UID = 'plugin::upload.file';
const MODEL_EXTENSIONS = ['.glb', '.gltf'];

type Section = Record<string, unknown> & { __component?: string };

function reject(index: number, field: string, message: string): never {
  throw new errors.ValidationError(message, {
    errors: [{ path: ['sections', String(index), field], message, name: 'ValidationError' }],
  });
}

/** Whether a relation value in the Document Service's input points at something. */
function isRelationSet(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value !== 'object') return true;
  const relation = value as {
    connect?: unknown[];
    set?: unknown[];
    documentId?: string;
    id?: number;
  };
  if (Array.isArray(relation.connect) || Array.isArray(relation.set)) {
    return (relation.connect?.length ?? 0) + (relation.set?.length ?? 0) > 0;
  }
  return Boolean(relation.documentId || relation.id);
}

function mediaId(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') {
    return (value as { id: number }).id;
  }
  return null;
}

/**
 * Rejects a `post-list` that names both a category and a tag (it lists one or
 * the other, or the latest articles), and a `scene` whose model is not a glTF
 * file (`.glb` or `.gltf`), which the frontend's 3D island could not load.
 */
export async function assertPageSectionsValid(
  strapi: Core.Strapi,
  data: Record<string, unknown>
): Promise<void> {
  if (!Array.isArray(data.sections)) return;
  const sections = data.sections as Section[];

  for (const [index, section] of sections.entries()) {
    if (section?.__component === 'section.post-list') {
      if (isRelationSet(section.category) && isRelationSet(section.tag)) {
        reject(index, 'tag', 'A post list shows a category or a tag, not both');
      }
    }
    if (section?.__component === 'section.scene') {
      const id = mediaId(section.model);
      if (id === null) continue;
      const file = (await strapi.db.query(FILE_UID).findOne({
        select: ['ext', 'name'],
        where: { id },
      })) as { ext?: string | null; name?: string } | null;
      const ext = (file?.ext ?? '').toLowerCase();
      if (!MODEL_EXTENSIONS.includes(ext)) {
        reject(
          index,
          'model',
          `A scene's model must be a .glb or .gltf file, not "${file?.name ?? id}"`
        );
      }
    }
  }
}
