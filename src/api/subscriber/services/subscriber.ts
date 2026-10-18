import { factories } from '@strapi/strapi';
import { SUBSCRIBER_UID } from '../../../constants/uids';
import type { LookupField, SubscriberRow } from '../types';

const ROW_FIELDS = [
  'id',
  'documentId',
  'email',
  'confirmationToken',
  'unsubscribeToken',
  'confirmed',
  'language',
  'createdAt',
  'updatedAt',
  'publishedAt',
];

export default factories.createCoreService(SUBSCRIBER_UID, ({ strapi }) => ({
  /**
   * Finds the subscriber whose `field` equals `value` exactly, or `null`.
   *
   * @remarks
   * Goes through `strapi.db.query` with a plain `where`, never the REST filter
   * syntax, so `value` is always compared as a string. Logs nothing: `value` is
   * an email or a token.
   */
  async findOneBy(field: LookupField, value: string): Promise<SubscriberRow | null> {
    const row = await strapi.db.query(SUBSCRIBER_UID).findOne({
      select: ROW_FIELDS,
      where: { [field]: value },
    });
    return (row as SubscriberRow | null) ?? null;
  },
}));
