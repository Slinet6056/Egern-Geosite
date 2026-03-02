# @surge-geosite/panel

SvelteKit SSR panel for Surge Geosite.

## Routes

- `/:lang/` where `lang = zh | en`
- Root `/` redirects to locale based on `Accept-Language`
- `/geosite*` proxy endpoints for local development and SSR data fetching

## Scripts

- `pnpm --filter @surge-geosite/panel run dev`
- `pnpm --filter @surge-geosite/panel run typecheck`
- `pnpm --filter @surge-geosite/panel run build`
- `pnpm --filter @surge-geosite/panel run cf:deploy`

## Cloudflare

`wrangler.toml` deploys the SvelteKit Cloudflare output:

- `main = ".svelte-kit/cloudflare/_worker.js"`
- `assets.directory = ".svelte-kit/cloudflare"`
- `services.GEOSITE_API -> surge-geosite` (required internal service binding)
