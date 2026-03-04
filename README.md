<div align="center">
  <h1>Egern Geosite</h1>
  <p>Automatically converts <code>Loyalsoldier/v2ray-rules-dat</code> datasets into ready-to-use Egern rule sets.</p>
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

1. Open the dashboard: https://egern.slinet.moe.
2. Search and select a dataset.
3. Copy the generated raw URL.
4. Reference it in your Egern `rule_set` rule.

If you want to use rule URLs directly, the format is:

- Rules path: `https://egern.slinet.moe/geosite/:name_with_filter`

`name_with_filter` has two forms:

- Without filter: `apple`
  Returns the full rules for the `apple` dataset.
- With filter: `apple@cn`
  Returns only rules tagged with `@cn`.

Egern example:

```yaml
rules:
  - rule_set:
      match: "https://egern.slinet.moe/geosite/apple@cn"
      policy: DIRECT
      update_interval: 86400
  - rule_set:
      match: "https://egern.slinet.moe/geosite/strict/proxy-list"
      policy: Proxy
      update_interval: 86400
```

## Advanced Usage

### API

- `GET /geosite`
- `GET /geosite/:name_with_filter` (default mode: `balanced`)
- `GET /geosite/:mode/:name_with_filter`

### Mode Guide

- `strict`: only lossless regex conversion
- `balanced`: controlled downgrade (default)
- `full`: most permissive conversion (widest coverage, highest over-match risk)

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
