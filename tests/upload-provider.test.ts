import { describe, it, expect, jest } from '@jest/globals';
import {
  usesLocalUploadProvider,
  warnLocalUploadsInProduction,
} from '../src/utils/upload-provider';

describe('usesLocalUploadProvider', () => {
  it('is true for the local provider and for no provider', () => {
    expect(usesLocalUploadProvider({ provider: 'local' })).toBe(true);
    expect(usesLocalUploadProvider({})).toBe(true);
    expect(usesLocalUploadProvider(undefined)).toBe(true);
  });

  it('is false for the S3-compatible provider', () => {
    expect(usesLocalUploadProvider({ provider: '@strapi/provider-upload-aws-s3' })).toBe(false);
  });
});

function fakeStrapi(uploadConfig: unknown) {
  const warn = jest.fn();
  const strapi = {
    log: { warn },
    config: { get: (key: string) => (key === 'plugin::upload' ? uploadConfig : undefined) },
  };
  return { strapi: strapi as never, warn };
}

describe('warnLocalUploadsInProduction', () => {
  it('warns once in production with the local provider', () => {
    const { strapi, warn } = fakeStrapi({ provider: 'local' });
    warnLocalUploadsInProduction(strapi, { NODE_ENV: 'production' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('admin origin');
  });

  it('is silent with the S3-compatible provider', () => {
    const { strapi, warn } = fakeStrapi({ provider: '@strapi/provider-upload-aws-s3' });
    warnLocalUploadsInProduction(strapi, { NODE_ENV: 'production' });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['development', 'test', undefined])('is silent when NODE_ENV is %s', (nodeEnv) => {
    const { strapi, warn } = fakeStrapi({ provider: 'local' });
    warnLocalUploadsInProduction(strapi, { NODE_ENV: nodeEnv });
    expect(warn).not.toHaveBeenCalled();
  });
});
