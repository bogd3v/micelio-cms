import { describe, it, expect } from '@jest/globals'
import { createPasswordValidator, parseBannedWords } from '../src/utils/password-rules'

describe('password rules', () => {
  const validate = createPasswordValidator(parseBannedWords('Acme, Garden, ab'))

  it('accepts a long ordinary password and a 64-character one', () => {
    expect(validate('correct horse battery')).toBe(true)
    expect(validate('x7'.repeat(32))).toBe(true)
  })

  it('refuses fewer than 8 characters, counting code points not bytes', () => {
    expect(() => validate('Ab1-xyz')).toThrow('at least 8 characters')
    expect(() => validate('')).toThrow('at least 8 characters')
    expect(() => validate('日本語日本語日')).toThrow('at least 8 characters')
    expect(validate('日本語日本語日本')).toBe(true)
  })

  it('refuses a common password whatever its case or width', () => {
    expect(() => validate('password')).toThrow('too common')
    expect(() => validate('PassWord')).toThrow('too common')
    expect(() => validate('ＰＡＳＳＷＯＲＤ')).toThrow('too common')
  })

  it('refuses a password from the breached list, not only the 3000 most common', () => {
    expect(() => validate('Mercedes1')).toThrow('known data breaches')
    expect(() => validate('abcdefgh1')).toThrow('known data breaches')
  })

  it('refuses a password that contains a built-in or configured word', () => {
    expect(() => validate('my-Micelio-site-1')).toThrow('tied to this site')
    expect(() => validate('ilove-STRAPI-cms')).toThrow('tied to this site')
    expect(() => validate('walk-in-ACME-field')).toThrow('tied to this site')
  })

  it('ignores configured words shorter than 4 characters', () => {
    expect(parseBannedWords('Acme, Garden, ab, ,')).toEqual(['acme', 'garden'])
    expect(parseBannedWords('My Site')).toEqual(['my site', 'mysite'])
    expect(validate('about-abacus-time')).toBe(true)
  })

  it('refuses a value that is not a string', () => {
    expect(() => validate(undefined)).toThrow('must be a string')
  })
})
