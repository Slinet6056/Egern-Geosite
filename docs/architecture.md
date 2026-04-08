# Egern Geosite / Surge Geosite Architecture

This document keeps the technical runtime/ops details for maintainers and contributors.

## Runtime Topology

Production uses two Cloudflare Workers on the same account:

- API Worker (`packages/worker`)
  - Serves `/geosite*`, `/geoip*`, `/surge/geosite*`, `/surge/geoip*`
  - Runs scheduled upstream refresh
- Panel Worker (`packages/panel`)
  - Serves dashboard pages for both `egern.slinet.moe` and `surge.slinet.moe`
  - Detects hostname at SSR time; renders Egern UI or Surge UI accordingly
  - Proxies panel-side API calls to the API Worker via service binding
  - Rewrites proxy paths: `surge.slinet.moe/geosite/*` → `/surge/geosite/*` on the API Worker

Route priority:

1. `egern.slinet.moe/geosite*` → API Worker
2. `egern.slinet.moe/geoip*` → API Worker
3. `egern.slinet.moe` (Custom Domain) → Panel Worker
4. `surge.slinet.moe` (Custom Domain) → Panel Worker

## Refresh Pipeline

1. Cron runs every 5 minutes.
2. Worker sends `HEAD` to upstream ZIP (`Loyalsoldier/v2ray-rules-dat`, release branch ZIP).
3. If ETag unchanged:
   - If geoip is pending, finalize geoip snapshot/index from stored raw data.
   - Otherwise only update check timestamp.
4. If ETag changed:
   - Download ZIP once.
   - Parse `geosite.dat` into source lists and validate parse/resolve.
   - Store raw `geoip.dat` as pending data for a later finalize pass.
   - Write geosite snapshot and index to R2.
   - Atomically switch `state/latest.json`.

## Serve Pipeline

1. Read `state/latest.json`.
2. Try artifact cache in R2.
3. If hit: return immediately.
4. If miss:
   - Optionally return stale artifact from previous ETag (non-filter path), then rebuild latest in background.
   - GeoIP only serves stale artifacts after the current `geoipSnapshot` exists; while a new ETag is still pending finalize, `/geoip*` returns `503`.
   - Otherwise build on demand and write artifact.

## API Surface

### Egern (`egern.slinet.moe`)

- `GET /geosite`
- `GET /geosite/:name_with_filter` or `GET /geosite/:name_with_filter.yaml`
- `GET /geosite/:mode/:name_with_filter` or `GET /geosite/:mode/:name_with_filter.yaml` (legacy compatibility path, returns 308 redirect)
- `GET /geoip`
- `GET /geoip/:country_code` or `GET /geoip/:country_code.yaml`
- `GET /geoip/:country_code?no_resolve=true` (adds `no_resolve: true` at top of ruleset output)

Geosite output is mode-less and emits upstream regexp entries as `domain_regex_set`.

### Surge (`surge.slinet.moe`, served via Panel → API Worker `/surge/*`)

- `GET /geosite` (Panel proxy → `/surge/geosite`)
- `GET /geosite/:name_with_filter.list?regex_mode=skip|standard|aggressive`
- `GET /geoip` (Panel proxy → `/surge/geoip`)
- `GET /geoip/:country_code.list?no_resolve=true`

Surge geosite response headers: `x-surge-regex-mode`, `x-surge-regex-total`, `x-surge-regex-converted`, `x-surge-regex-skipped`.

`regex_mode` controls how V2Ray `regexp:` entries (which match domain names) are converted to Surge `URL-REGEX` (which matches full URLs):

- `skip`: drop all regexp entries
- `standard` (default): converts entries that remain safe as host-only URL patterns — exact domain (`^x$`), optional-subdomain suffix (`(^|\.)x$`), general end-anchored host suffix (`x$`, including forms like `javdb\d+\.com$`), or domain prefix (`^x`); drops entries with lookaheads, backreferences, slashes, or top-level alternation
- `aggressive`: converts all entries by stripping anchors and wrapping with `^https?://…/`; nothing is dropped, but results may be over-broad or imprecise

## R2 Storage Layout

- `state/latest.json`
- `snapshots/{etag}/geosite/sources.json.gz`
- `snapshots/{etag}/geosite/index.json`
- `artifacts/{etag}/geosite/{name[@filter]}.yaml`
- `snapshots/{etag}/geoip/raw.dat`
- `snapshots/{etag}/geoip/sources.json.gz`
- `snapshots/{etag}/geoip/index.json`
- `artifacts/{etag}/geoip/{country}.yaml`
- `artifacts/{etag}/surge/geosite/{name[@filter]}@{regexMode}.list`
- `artifacts/{etag}/surge/geoip/{country}.list`

## Operations

- Keep lifecycle policies for `snapshots/` and `artifacts/` (for example 7-30 days).
- For a clean storage-layout reset, delete `state/latest.json` together with `snapshots/` and `artifacts/`, or run a refresh immediately after the purge so the persisted keys are rebuilt.
- CLI (`packages/cli`) is for local debug/verification, not required in production serving path.
