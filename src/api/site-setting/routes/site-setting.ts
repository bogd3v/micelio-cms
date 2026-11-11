/**
 * The only route of the retired single type `api::site-setting`: `GET /api/site-setting`, which the
 * frontends of 0.6 read (ADR-0017, D6). It has no core router, so nothing writes the single type
 * through the content API; the controller answers from the default site.
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/site-setting',
      handler: 'site-setting.find',
    },
  ],
}
