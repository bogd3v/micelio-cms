import { jsonLogFormat } from '../src/utils/json-log-format'

/**
 * Logger override merged over Strapi's default (`server.logger.config` still wins).
 * In production every line is a JSON object with a UTC timestamp (ASVS V16.2.2,
 * V16.2.4; docs/security/logging.md). Elsewhere Strapi's pretty format stays.
 * The destination is still the one console transport.
 */
const config = (): { format?: typeof jsonLogFormat } =>
  process.env.NODE_ENV === 'production' ? { format: jsonLogFormat } : {}

export default config
