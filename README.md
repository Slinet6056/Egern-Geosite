<div align="center">
  <h1>Egern Geosite</h1>
  <p>Automatically converts <a href="https://github.com/Loyalsoldier/v2ray-rules-dat">Loyalsoldier/v2ray-rules-dat</a> datasets (geosite + geoip) into ready-to-use Egern rule sets.</p>
  <p>
    English | <a href="./README.zh-CN.md">中文</a>
  </p>
  <p>
    <a href="https://egern.slinet.moe"><strong>Open Dashboard</strong></a>
  </p>
</div>

<p align="center">
  <img src="./docs/assets/panel-dashboard.png" alt="Egern Geosite Dashboard" />
</p>

## Direct Use

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

## Advanced Usage

### API

- `GET /geosite`
- `GET /geosite/:name_with_filter` or `GET /geosite/:name_with_filter.yaml`
- `GET /geosite/:mode/:name_with_filter` or `GET /geosite/:mode/:name_with_filter.yaml` (legacy compatibility path, returns 308 redirect)
- `GET /geoip`
- `GET /geoip/:country_code` or `GET /geoip/:country_code.yaml`
- `GET /geoip/:country_code?no_resolve=true` or `GET /geoip/:country_code.yaml?no_resolve=true`

Geosite output is now mode-less and lossless for upstream `regexp` entries (emitted as `domain_regex_set`).

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
