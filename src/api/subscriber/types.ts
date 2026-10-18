import type { LOOKUP_FIELDS } from './constants';

/** An attribute `findOneBy` can match on. */
export type LookupField = (typeof LOOKUP_FIELDS)[number];

/** A subscriber row as the lookup returns it: what `GET /api/subscribers` returns. */
export interface SubscriberRow {
  id: number;
  documentId: string;
  email: string;
  confirmationToken: string | null;
  unsubscribeToken: string | null;
  confirmed: boolean;
  language: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
