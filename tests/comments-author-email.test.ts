import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { getPublicRole, getRole } from './helpers/permissions'
import type { ApiComment } from './helpers/api-types'
import { AUTHOR_FILTER_KEYS } from '../src/constants/comments'
import { findBlockedFilterKey, stripPrivateCommentFields } from '../src/utils/comment-author'

const ARTICLE_UID = 'api::article.article'
const COMMENT_UID = 'plugin::comments.comment'
const EMAIL = 'commenter@example.test'
const ACTIONS = ['findAll', 'findAllFlat', 'findAllInHierarchy']

describe('Comment author emails', () => {
  let relation: string
  let userId: number
  const http = () => request(strapi.server.httpServer)

  beforeAll(async () => {
    await setupStrapi()
    const publicRole = await getPublicRole()
    for (const action of ACTIONS) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action: `plugin::comments.client.${action}`, role: publicRole.id },
      })
    }
    await strapi.service('plugin::users-permissions.users-permissions').initialize()

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Email target', slug: 'email-target' } })
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId })
    relation = `${ARTICLE_UID}:${draft.documentId}`

    const role = await getRole('authenticated')
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'commenter',
      email: EMAIL,
      password: 'Sup3r-secret',
      provider: 'local',
      confirmed: true,
      role: role.id,
    })
    userId = user.id
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'by a visitor',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'visitor-1',
        authorName: 'Visitor',
        authorEmail: EMAIL,
      },
    })
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'by a user',
        related: relation,
        approvalStatus: 'APPROVED',
        authorUser: userId,
      },
    })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it.each([
    ['the flat list', (relation: string) => `/api/comments/${relation}/flat`],
    ['the hierarchy', (relation: string) => `/api/comments/${relation}`],
  ])('does not return an author email in %s', async (_name, path) => {
    const res = await http().get(path(relation))
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain(EMAIL)
    const comments = (Array.isArray(res.body) ? res.body : res.body.data) as ApiComment[]
    // Both authors are still there, only the address is gone.
    expect(comments.map((comment) => comment.author?.name).sort()).toEqual(['Visitor', 'commenter'])
  })

  it('does not return it in a reply either', async () => {
    const parent = await strapi
      .documents(COMMENT_UID)
      .findFirst({ filters: { authorId: 'visitor-1' } })
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'a reply',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'visitor-2',
        authorName: 'Replier',
        authorEmail: EMAIL,
        threadOf: parent!.id,
      },
    })
    const res = await http().get(`/api/comments/${relation}`)
    expect(JSON.stringify(res.body)).toContain('a reply')
    expect(JSON.stringify(res.body)).not.toContain(EMAIL)
  })
})

describe('stripPrivateCommentFields', () => {
  it('drops author.email through data and children, and keeps the rest', () => {
    const input = {
      data: [
        {
          id: 1,
          author: { id: 'a', name: 'A', email: 'a@example.test' },
          children: [{ id: 2, author: { id: 'b', email: 'b@example.test' }, children: [] }],
        },
      ],
    }
    expect(stripPrivateCommentFields(input)).toEqual({
      data: [
        {
          id: 1,
          author: { id: 'a', name: 'A' },
          children: [{ id: 2, author: { id: 'b' }, children: [] }],
        },
      ],
    })
    // The input is not changed.
    expect(input.data[0].author.email).toBe('a@example.test')
  })

  it('leaves values without an author alone', () => {
    expect(stripPrivateCommentFields(null)).toBeNull()
    expect(stripPrivateCommentFields({ id: 1, author: null })).toEqual({ id: 1, author: null })
  })
})

describe('stripPrivateCommentFields: threadOf and reports', () => {
  it('reduces threadOf to its id and drops the reports at every level', () => {
    const input = {
      data: [
        {
          id: 2,
          reports: [{ id: 9, content: 'x' }],
          author: { id: 'b', email: 'b@example.test' },
          threadOf: { id: 1, author: { id: 'a', email: 'a@example.test' }, reports: [{ id: 8 }] },
          children: [{ id: 3, reports: [], threadOf: 2 }],
        },
      ],
    }
    expect(stripPrivateCommentFields(input)).toEqual({
      data: [
        {
          id: 2,
          author: { id: 'b' },
          threadOf: { id: 1 },
          children: [{ id: 3, threadOf: 2 }],
        },
      ],
    })
  })
})

describe('stripPrivateCommentFields: threadOf values', () => {
  it('keeps null and a bare id, and gives an object without id as an empty object', () => {
    expect(stripPrivateCommentFields({ id: 1, threadOf: null })).toEqual({ id: 1, threadOf: null })
    expect(stripPrivateCommentFields({ id: 1, threadOf: 7 })).toEqual({ id: 1, threadOf: 7 })
    expect(stripPrivateCommentFields({ id: 1, threadOf: { content: 'x' } })).toEqual({
      id: 1,
      threadOf: { id: undefined },
    })
  })
})

describe('findBlockedFilterKey', () => {
  it('finds an author key at any depth, in objects and arrays', () => {
    expect(findBlockedFilterKey({ authorEmail: { $eq: 'a' } }, AUTHOR_FILTER_KEYS)).toBe(
      'authorEmail'
    )
    expect(
      findBlockedFilterKey(
        { $and: [{ $or: [{ threadOf: { authorId: 'x' } }] }] },
        AUTHOR_FILTER_KEYS
      )
    ).toBe('authorId')
  })

  it('answers null for other filters and for non-objects', () => {
    expect(findBlockedFilterKey({ content: { $contains: 'a' } }, AUTHOR_FILTER_KEYS)).toBeNull()
    expect(findBlockedFilterKey(undefined, AUTHOR_FILTER_KEYS)).toBeNull()
    expect(findBlockedFilterKey('authorEmail', AUTHOR_FILTER_KEYS)).toBeNull()
  })
})
