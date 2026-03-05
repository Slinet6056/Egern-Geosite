# @egern-geosite/cli

Development/debug helper for generating geosite artifacts locally.

## Command

- `egern-geosite build --data-dir <dir> [--list <a,b,c>] [--out-dir <dir>]`

## Output Layout

- `<out>/meta.json`
- `<out>/index/geosite.json`
- `<out>/rules/<list>.yaml`
- `<out>/resolved/<list>.json`
- `<out>/stats/global.json`
- `<out>/stats/lists/<list>.json`
