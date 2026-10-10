const { compileStrapi } = require('@strapi/strapi');

/**
 * Compiles the TypeScript sources into `dist/` once per Jest run. Suites then
 * boot Strapi from that output (`tests/strapi.ts`); compiling in every suite
 * made parallel workers overwrite each other's files and fail on half-written
 * JSON.
 */
module.exports = async function globalSetup() {
  await compileStrapi();
};
