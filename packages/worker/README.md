# @egern-geosite/worker

Cloudflare Worker runtime for geosite API serving with built-in cron refresh.

## Endpoints

- `GET /geosite`
- `GET /geosite/:name_with_filter` or `GET /geosite/:name_with_filter.yaml` (default mode: `balanced`)
- `GET /geosite/:mode/:name_with_filter` or `GET /geosite/:mode/:name_with_filter.yaml` where mode is `strict|balanced|full`
- `GET /geosite-srs/:name` or `GET /geosite-srs/:name.srs`
- `GET /geosite-mrs/:name` or `GET /geosite-mrs/:name.mrs`

## Runtime Model

- `scheduled`:
  - HEAD upstream ZIP to check ETag.
  - If ETag unchanged: update check timestamp only.
  - If ETag changed: download ZIP once, parse `geosite.dat` into source lists, write snapshot + index to R2, then update `state/latest.json`.
- `fetch`:
  - Route `/geosite*` requests to API handlers.
  - API handlers read latest state from R2.
  - Serve prebuilt artifact from `artifacts/{etag}/{mode}/{name[@filter]}.yaml` when available.
  - On miss, compile on-demand from snapshot and cache artifact.
  - Unknown filters are served as empty output but are not persisted as artifacts.
  - If previous ETag artifact exists, return stale artifact immediately and refresh latest artifact in background (`waitUntil`).
  - On first successful compile for a list, lazily enrich index `filters` for that list.

## R2 Layout

- `state/latest.json`
- `snapshots/{etag}/sources.json.gz`
- `snapshots/{etag}/index/geosite.json`
- `artifacts/{etag}/{mode}/{name[@filter]}.yaml`

Retention:

- Configure R2 Lifecycle rules for `snapshots/` and `artifacts/` prefixes in Cloudflare dashboard.
- Recommended: keep a short retention window (for example 7-30 days) based on your traffic and rollback needs.

## Wrangler

`packages/worker/wrangler.toml` includes:

- `[triggers] crons = ["*/5 * * * *"]`
- `[vars]` for `UPSTREAM_ZIP_URL` and `UPSTREAM_USER_AGENT`
- `[[r2_buckets]]` binding `GEOSITE_BUCKET`

## Scripts

- `pnpm run worker:dev`
- `pnpm run worker:dev:cron` (local cron simulation)
- `pnpm run worker:deploy`

## Deploy

```bash
pnpm run worker:login
pnpm run worker:r2:create
pnpm run worker:deploy
```
