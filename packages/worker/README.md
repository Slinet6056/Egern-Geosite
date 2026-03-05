# @egern-geosite/worker

Cloudflare Worker runtime for geosite/geoip API serving with built-in cron refresh.

## Endpoints

- `GET /geosite`
- `GET /geosite/:name_with_filter` or `GET /geosite/:name_with_filter.yaml` (default mode: `balanced`)
- `GET /geosite/:mode/:name_with_filter` or `GET /geosite/:mode/:name_with_filter.yaml` where mode is `strict|balanced|full`
- `GET /geoip`
- `GET /geoip/:country_code` or `GET /geoip/:country_code.yaml`
- `GET /geoip/:country_code?no_resolve=true` (adds `no_resolve: true` at top of ruleset output)
- `GET /geosite-srs/:name` or `GET /geosite-srs/:name.srs`
- `GET /geosite-mrs/:name` or `GET /geosite-mrs/:name.mrs`

## Runtime Model

- `scheduled`:
  - HEAD upstream ZIP to check ETag.
  - If ETag changed: download ZIP once, parse `geosite.dat`, write geosite snapshot/index, and store raw `geoip.dat` as pending data in R2.
  - If ETag unchanged but geoip is pending: parse pending raw `geoip.dat`, write geoip snapshot/index, then mark geoip as ready.
  - If ETag unchanged and no pending geoip: update check timestamp only.
- `fetch`:
  - Route `/geosite*` and `/geoip*` requests to API handlers.
  - API handlers read latest state from R2.
  - Serve prebuilt artifact from `artifacts/{etag}/{mode}/{name[@filter]}.yaml` (`geosite`) and `artifacts/{etag}/geoip/{country}.yaml` (`geoip`) when available.
  - On miss, compile on-demand from snapshot and cache artifact.
  - Unknown filters are served as empty output but are not persisted as artifacts.
  - If previous ETag artifact exists, return stale artifact immediately and refresh latest artifact in background (`waitUntil`).
  - On first successful compile for a list, lazily enrich index `filters` for that list.

## R2 Layout

- `state/latest.json`
- `snapshots/{etag}/sources.json.gz`
- `snapshots/{etag}/index/geosite.json`
- `snapshots/{etag}/geoip/raw.dat`
- `snapshots/{etag}/geoip/sources.json.gz`
- `snapshots/{etag}/index/geoip.json`
- `artifacts/{etag}/{mode}/{name[@filter]}.yaml`
- `artifacts/{etag}/geoip/{country}.yaml`

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
