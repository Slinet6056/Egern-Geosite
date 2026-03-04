# @egern-geosite/panel

SvelteKit SSR panel for Egern Geosite.

## Routes

- `/:lang/` where `lang = zh | en`
- Root `/` redirects to locale based on `Accept-Language`
- `/geosite*` proxy endpoints for local development and SSR data fetching

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
