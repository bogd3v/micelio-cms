import { describe, it, expect } from '@jest/globals';
import pluginsConfig from '../config/plugins';
import { smtpTlsOptions } from '../src/utils/smtp';

describe('smtpTlsOptions', () => {
  it('uses implicit TLS on port 465, whatever the requirement says', () => {
    expect(smtpTlsOptions(465, undefined)).toEqual({ secure: true, requireTLS: false });
    expect(smtpTlsOptions(465, 'false')).toEqual({ secure: true, requireTLS: false });
  });

  it('requires STARTTLS on any other port when the variable is unset', () => {
    expect(smtpTlsOptions(587, undefined)).toEqual({ secure: false, requireTLS: true });
    expect(smtpTlsOptions(25, undefined)).toEqual({ secure: false, requireTLS: true });
  });

  it.each(['true', 'TRUE', '1', 'yes', ''])('keeps the requirement for %j', (value) => {
    expect(smtpTlsOptions(587, value).requireTLS).toBe(true);
  });

  it.each(['false', 'FALSE', ' False '])('turns it off only for %j', (value) => {
    expect(smtpTlsOptions(1025, value)).toEqual({ secure: false, requireTLS: false });
  });
});

describe('config/plugins.ts email transport', () => {
  const emailOptions = (vars: Record<string, string>) => {
    const env = Object.assign((key: string, fallback?: string) => vars[key] ?? fallback, {
      int: (key: string, fallback: number) => (vars[key] ? Number(vars[key]) : fallback),
      bool: (key: string, fallback: boolean) => (vars[key] ? vars[key] === 'true' : fallback),
      array: (key: string, fallback: string[]) => (vars[key] ? vars[key].split(',') : fallback),
    });
    const config = pluginsConfig({ env } as never) as {
      email: { config: { providerOptions: Record<string, unknown> } };
    };
    return config.email.config.providerOptions;
  };

  it('requires STARTTLS by default', () => {
    expect(emailOptions({ SMTP_HOST: 'smtp.example.com' })).toMatchObject({
      secure: false,
      requireTLS: true,
    });
  });

  it('lets the operator turn it off with the exact value false', () => {
    expect(
      emailOptions({ SMTP_HOST: 'smtp.example.com', SMTP_REQUIRE_TLS: 'false' })
    ).toMatchObject({
      requireTLS: false,
    });
  });
});
