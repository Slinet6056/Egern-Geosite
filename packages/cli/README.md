# @egern-geosite/cli

Development/debug helper for generating geosite artifacts locally.

## Command

- `egern-geosite build --data-dir <dir> [--list <a,b,c>] [--out-dir <dir>]`
- `egern-geosite analyze-surge-regex [--data-dir <dir> | --fetch-upstream] [--list <a,b,c>] [--report-json <path>]`

## Output Layout

- `<out>/meta.json`
- `<out>/index/geosite.json`
- `<out>/rules/<list>.yaml`
- `<out>/resolved/<list>.json`
- `<out>/stats/global.json`
- `<out>/stats/lists/<list>.json`

## Regex Analysis

- `analyze-surge-regex` reuses the real upstream `v2ray-rules-dat` data shape and reports which `regexp:` rules cannot be converted by Surge `standard` mode.
- When `--data-dir` is omitted, it shallow-clones the upstream `release` branch automatically.
- The command prints a summary grouped by failure reason and writes the full JSON report to `out/surge-regex-analysis.json` by default.
