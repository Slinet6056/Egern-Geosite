# @egern-geosite/panel

SvelteKit SSR panel for Egern Geosite.

## Routes

- `/` for the Geosite and GeoIP dashboard views
- User-selected locale is persisted on the same URL without a locale prefix
- `/geosite*` proxy endpoints for local development and SSR data fetching
- `/geoip*` proxy endpoints for local development and SSR data fetching

## Scripts

- `pnpm --filter @egern-geosite/panel run dev`
- `pnpm --filter @egern-geosite/panel run typecheck`
- `pnpm --filter @egern-geosite/panel run build`
- `pnpm --filter @egern-geosite/panel run cf:deploy`

## Cloudflare

`wrangler.toml` deploys the SvelteKit Cloudflare output:

- `main = ".svelte-kit/cloudflare/_worker.js"`
- `assets.directory = ".svelte-kit/cloudflare"`
- `services.GEOSITE_API -> egern-geosite` (required internal service binding)
