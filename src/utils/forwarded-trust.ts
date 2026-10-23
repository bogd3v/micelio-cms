import type Koa from 'koa'
import type { ClientIpSettings } from './rate-limit/types'
import { trustsForwardedHeaders } from './client-ip'

type Getter = (this: Koa.Request) => string

/** Koa's request prototype property, read through its getter. */
function koaGetter(app: Koa, name: 'protocol' | 'host'): Getter {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(app.request), name)
  if (!descriptor?.get) throw new Error(`Koa request.${name} is not a getter`)
  return descriptor.get as Getter
}

/**
 * Makes `ctx.protocol` and `ctx.host` follow `X-Forwarded-Proto` and `-Host`
 * (Koa's `proxy` option, `TRUST_PROXY_PROTOCOL`) only for requests whose peer
 * is trusted under `TRUST_PROXY`; for any other peer they come from the socket
 * and the `Host` header, as with `proxy` off.
 *
 * @remarks
 * Overrides the two getters on the app's own request object, so it holds for
 * every middleware, including the ones plugins mount ahead of the root's
 * (Fedify). Does nothing when `app.proxy` is off.
 */
export function installForwardedTrust(app: Koa, settings: ClientIpSettings): void {
  if (!app.proxy) return
  const forwarded = { protocol: koaGetter(app, 'protocol'), host: koaGetter(app, 'host') }

  const trusted = (request: Koa.Request): boolean =>
    trustsForwardedHeaders(
      settings.trust,
      request.req.socket.remoteAddress,
      request.get(settings.header)
    )
  const read = (request: Koa.Request, name: 'protocol' | 'host'): string => {
    if (trusted(request)) return forwarded[name].call(request)
    // The same reading Koa does with `proxy` off.
    if (name === 'protocol') {
      return (request.req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
    }
    const http2 = request.req.httpVersionMajor >= 2
    return String(http2 ? (request.req.headers[':authority'] ?? '') : request.get('Host'))
  }

  Object.defineProperties(app.request, {
    protocol: {
      configurable: true,
      get(this: Koa.Request) {
        return read(this, 'protocol')
      },
    },
    host: {
      configurable: true,
      get(this: Koa.Request) {
        return read(this, 'host')
      },
    },
  })
}
