<div align="center">
  <h1>Egern Geosite / Surge Geosite</h1>
  <p>Automatically converts <a href="https://github.com/Loyalsoldier/v2ray-rules-dat">Loyalsoldier/v2ray-rules-dat</a> datasets (geosite + geoip) into ready-to-use rule sets for Egern and Surge.</p>
  <p>
    English | <a href="./README.zh-CN.md">中文</a>
  </p>
  <p>
    <a href="https://egern.slinet.moe"><strong>Egern Dashboard</strong></a>
    &nbsp;|&nbsp;
    <a href="https://surge.slinet.moe"><strong>Surge Dashboard</strong></a>
  </p>
</div>

<p align="center">
  <img src="./docs/assets/panel-dashboard.png" alt="Dashboard" />
</p>

## Egern

### Direct Use

1. Open the dashboard: <https://egern.slinet.moe>.
2. Search and select a dataset.
3. Copy the generated raw URL.
4. Reference it in your Egern `rule_set` rule.

If you want to use rule URLs directly, the format is:

- Recommended rules path: `https://egern.slinet.moe/geosite/:name_with_filter.yaml`
- Compatibility path (also valid): `https://egern.slinet.moe/geosite/:name_with_filter`
- GeoIP rules path: `https://egern.slinet.moe/geoip/:country_code.yaml`
- GeoIP rules path with DNS skip: `https://egern.slinet.moe/geoip/:country_code.yaml?no_resolve=true`

`name_with_filter` has two forms:

- Without filter: `apple`
  Returns the full rules for the `apple` dataset.
- With filter: `apple@cn`
  Returns only rules tagged with `@cn`.

`country_code` example:

- `cn`
  Returns CIDR rules converted from the `CN` GeoIP dataset.

Egern example:

```yaml
rules:
  - rule_set:
      match: "https://egern.slinet.moe/geosite/apple@cn.yaml"
      policy: DIRECT
      update_interval: 86400
  - rule_set:
      match: "https://egern.slinet.moe/geosite/proxy-list.yaml"
      policy: Proxy
      update_interval: 86400
  - rule_set:
      match: "https://egern.slinet.moe/geoip/cn.yaml?no_resolve=true"
      policy: DIRECT
      update_interval: 86400
```

### API

- `GET /geosite`
- `GET /geosite/:name_with_filter` or `GET /geosite/:name_with_filter.yaml`
- `GET /geosite/:mode/:name_with_filter` or `GET /geosite/:mode/:name_with_filter.yaml` (legacy compatibility path, returns 308 redirect)
- `GET /geoip`
- `GET /geoip/:country_code` or `GET /geoip/:country_code.yaml`
- `GET /geoip/:country_code?no_resolve=true` or `GET /geoip/:country_code.yaml?no_resolve=true`

Geosite output is now mode-less and lossless for upstream `regexp` entries (emitted as `domain_regex_set`).

## Surge

### Quick Start

1. Open the dashboard: <https://surge.slinet.moe>.
2. Search and select a dataset.
3. Choose a regex conversion mode.
4. Copy the generated `.list` URL and reference it in your Surge `RULE-SET`.

If you want to use rule URLs directly, the format is:

- Geosite rules path: `https://surge.slinet.moe/geosite/:name_with_filter.list`
- Geosite rules path with regex mode: `https://surge.slinet.moe/geosite/:name_with_filter.list?regex_mode=standard`
- GeoIP rules path: `https://surge.slinet.moe/geoip/:country_code.list`
- GeoIP rules path with no-resolve: `https://surge.slinet.moe/geoip/:country_code.list?no_resolve=true`

**Regex conversion modes** — V2Ray `regexp:` entries match domain names, but Surge `URL-REGEX` matches full URLs.
The `regex_mode` parameter controls how they are converted:

| Mode | Behavior |
|------|----------|
| `skip` | All `regexp:` entries are dropped |
| `standard` (default) | Only converts entries that match recognized structures: exact domain (`^x$`), optional-subdomain suffix (`(^\|\\.)x$`), forced-subdomain suffix (`\\.x$`), or domain prefix (`^x`). Entries with lookaheads, backreferences, slashes, or top-level alternation are dropped |
| `aggressive` | Converts all entries by stripping anchors and wrapping with `^https?://…/`. Nothing is dropped, but results may be over-broad or imprecise |

Surge example:

```ini
[Rule]
RULE-SET,https://surge.slinet.moe/geosite/apple@cn.list,DIRECT
RULE-SET,https://surge.slinet.moe/geosite/netflix.list?regex_mode=standard,PROXY
RULE-SET,https://surge.slinet.moe/geoip/cn.list?no_resolve=true,DIRECT
```

### Surge API

- `GET /geosite/:name_with_filter.list`
- `GET /geosite/:name_with_filter.list?regex_mode=skip|standard|aggressive`
- `GET /geoip` (returns JSON index)
- `GET /geoip/:country_code.list`
- `GET /geoip/:country_code.list?no_resolve=true`

Response headers for geosite include regex conversion statistics:
`x-surge-regex-total`, `x-surge-regex-converted`, `x-surge-regex-skipped`.

## For Maintainers

Local dev:

```bash
pnpm install
pnpm build
pnpm test
pnpm panel:dev
pnpm worker:dev
```

Deploy:

```bash
pnpm panel:deploy
pnpm worker:deploy
```

Technical architecture: [docs/architecture.md](./docs/architecture.md)
