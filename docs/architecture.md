# Egern Geosite Architecture

This document keeps the technical runtime/ops details for maintainers and contributors.

## Runtime Topology

Production uses two Cloudflare Workers on the same domain:

- API Worker (`packages/worker`)
  - Serves `/geosite*`
  - Runs scheduled upstream refresh
- Panel Worker (`packages/panel`)
  - Serves dashboard pages (`/`, `/zh`, `/en`, etc.)
  - Proxies panel-side API calls to geosite endpoints

Recommended route priority:

1. `egern.slinet.moe/geosite*` -> API Worker
2. `egern.slinet.moe` (Custom Domain) -> Panel Worker

## Refresh Pipeline

1. Cron runs every 5 minutes.
2. Worker sends `HEAD` to upstream ZIP (`Loyalsoldier/v2ray-rules-dat`, release branch ZIP).
3. If ETag unchanged: only update check timestamp.
4. If ETag changed:
   - Download ZIP once.
   - Parse `geosite.dat` into source lists.
   - Validate parse/resolve.
   - Write snapshot and index to R2.
   - Atomically switch `state/latest.json`.

## Serve Pipeline

1. Read `state/latest.json`.
2. Try `artifacts/{etag}/{mode}/{name[@filter]}.yaml`.
3. If hit: return immediately.
4. If miss:
   - Optionally return stale artifact from previous ETag (non-filter path), then rebuild latest in background.
   - Otherwise build on demand and write artifact.

## API Surface

- `GET /geosite`
- `GET /geosite/:name_with_filter` or `GET /geosite/:name_with_filter.yaml` (default mode: `balanced`)
- `GET /geosite/:mode/:name_with_filter` or `GET /geosite/:mode/:name_with_filter.yaml`
- `GET /geosite-srs/:name` or `GET /geosite-srs/:name.srs`
- `GET /geosite-mrs/:name` or `GET /geosite-mrs/:name.mrs`

`name_with_filter` format:

- `apple` => full converted list
- `apple@cn` => only rules tagged with `@cn`

## Modes

- `strict`: only lossless regex conversion
- `balanced`: controlled downgrade (default)
- `full`: most permissive conversion

## R2 Storage Layout

- `state/latest.json`
- `snapshots/{etag}/sources.json.gz`
- `snapshots/{etag}/index/geosite.json`
- `artifacts/{etag}/{mode}/{name[@filter]}.yaml`

## Operations

- Keep lifecycle policies for `snapshots/` and `artifacts/` (for example 7-30 days).
- CLI (`packages/cli`) is for local debug/verification, not required in production serving path.
