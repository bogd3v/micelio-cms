import { consolidateCategories } from '../../src/migrations/consolidate-categories';

/**
 * BogDev's five redesign categories, as production has them: the migration
 * only consolidates an instance that already has one of BogDev's categories,
 * so a legacy one is created first. A new instance gets none at boot (#74).
 */
export async function createBogdevCategories(): Promise<void> {
  await strapi.documents('api::category.category').create({
    data: { name: 'privacy', slug: 'privacy' },
  });
  await consolidateCategories(strapi);
}
