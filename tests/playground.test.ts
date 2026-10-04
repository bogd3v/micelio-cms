import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';
import { blocksToPlainText } from '../src/api/article/utils/plain-text';
import type { Modules } from '@strapi/strapi';
import type { ApiDocument } from './helpers/api-types';

const ARTICLE_UID = 'api::article.article';

type ArticleInput = Modules.Documents.Params.Data.Input<typeof ARTICLE_UID>;
type PlaygroundInput = Extract<
  NonNullable<ArticleInput['blocks']>[number],
  { __component: 'shared.playground' }
>;

const playground = (
  fields: Partial<Omit<PlaygroundInput, '__component'>> = {}
): PlaygroundInput => ({
  __component: 'shared.playground',
  runtime: 'sql',
  code: 'SELECT name FROM birds ORDER BY name;',
  ...fields,
});

const richText = (body: string) => ({ __component: 'shared.rich-text' as const, body });

describe('Playground block', () => {
  const create = (data: ArticleInput) => strapi.documents(ARTICLE_UID).create({ data });

  async function publishedBlocks(slug: string, populate: object) {
    const res = await request(strapi.server.httpServer)
      .get('/api/articles')
      .query({ filters: { slug: { $eq: slug } }, populate })
      .expect(200);
    const [article] = res.body.data as (ApiDocument & { blocks: { __component: string }[] })[];
    return article.blocks;
  }

  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('article', ['find', 'findOne']);
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('returns every field of the block through the public API', async () => {
    const block = playground({
      expectedOutput: 'name\n----\nCopetón\nMirla',
      setup: "CREATE TABLE birds (name TEXT);\nINSERT INTO birds VALUES ('Mirla'), ('Copetón');",
      caption: 'Las aves del parque, ordenadas',
    });
    const draft = await create({
      title: 'SQL playground',
      slug: 'sql-playground',
      blocks: [richText('Antes del ejemplo.'), block],
    });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });

    const blocks = await publishedBlocks('sql-playground', { blocks: { populate: '*' } });
    expect(blocks[1]).toMatchObject(block);
  });

  it('accepts every runtime and leaves the optional fields empty', async () => {
    for (const runtime of ['python', 'sql', 'javascript'] as const) {
      const slug = `runtime-${runtime}`;
      const draft = await create({
        title: `Runtime ${runtime}`,
        slug,
        blocks: [playground({ runtime, code: 'print(1)' })],
      });
      await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });

      const [block] = await publishedBlocks(slug, { blocks: { populate: '*' } });
      expect(block).toMatchObject({
        __component: 'shared.playground',
        runtime,
        code: 'print(1)',
        expectedOutput: null,
        setup: null,
        caption: null,
      });
    }
  });

  // The frontend populates `blocks` with fragments; a component left out of
  // `on` is dropped from the response, so it has to name the playground.
  it('is returned by a fragment populate only when it names it', async () => {
    const draft = await create({
      title: 'Fragments',
      slug: 'fragments',
      blocks: [richText('Texto.'), playground()],
    });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });

    const blocks = await publishedBlocks('fragments', {
      blocks: {
        on: {
          'shared.rich-text': { populate: '*' },
          'shared.playground': true,
        },
      },
    });
    expect(blocks.map((block) => block.__component)).toEqual([
      'shared.rich-text',
      'shared.playground',
    ]);

    const unnamed = await publishedBlocks('fragments', {
      blocks: { on: { 'shared.rich-text': { populate: '*' } } },
    });
    expect(unnamed.map((block) => block.__component)).toEqual(['shared.rich-text']);
  });

  it('rejects a runtime outside the enum', async () => {
    await expect(
      create({
        title: 'Ruby',
        // @ts-expect-error ruby is not one of the runtimes
        blocks: [playground({ runtime: 'ruby' })],
      })
    ).rejects.toThrow(/must be one of/);
  });

  it('limits the size of code, setup and expected output', async () => {
    for (const [field, max] of [
      ['code', 5000],
      ['setup', 20000],
      ['expectedOutput', 5000],
    ] as const) {
      await expect(
        create({ title: `Long ${field}`, blocks: [playground({ [field]: 'x'.repeat(max) })] })
      ).resolves.toBeTruthy();
      await expect(
        create({
          title: `Too long ${field}`,
          blocks: [playground({ [field]: 'x'.repeat(max + 1) })],
        })
      ).rejects.toThrow(/at most/);
    }
  });

  it('saves a draft without runtime or code but does not publish it', async () => {
    for (const missing of ['runtime', 'code'] as const) {
      const block: Record<string, unknown> = playground();
      delete block[missing];
      const draft = await create({
        title: `Without ${missing}`,
        // @ts-expect-error the block lacks a required field on purpose
        blocks: [block],
      });
      await expect(
        strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId })
      ).rejects.toThrow(new RegExp(`blocks\\[0\\]\\.${missing} must`));
    }
  });

  it('adds the caption to the plain text but not the code', async () => {
    expect(
      blocksToPlainText([
        richText('Primero'),
        playground({
          code: 'SELECT secreto;',
          setup: 'CREATE TABLE oculta;',
          caption: ' Consulta ',
        }),
        playground({ code: 'print(2)' }),
      ])
    ).toBe('Primero\n\nConsulta');

    const draft = await create({
      title: 'Searchable caption',
      blocks: [playground({ caption: 'Aves del humedal' })],
    });
    const row = await strapi.db
      .query(ARTICLE_UID)
      .findOne({ where: { documentId: draft.documentId, publishedAt: null } });
    expect(row.plainText).toBe('Aves del humedal');
  });
});
