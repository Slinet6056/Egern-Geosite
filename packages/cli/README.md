# @egern-geosite/cli

Development/debug helper for generating geosite artifacts locally.

## Command

- `egern-geosite build --data-dir <dir> [--list <a,b,c>] [--out-dir <dir>]`

## Output Layout

- `<out>/meta.json`
- `<out>/index/geosite.json`
- `<out>/rules/strict/<list>.yaml`
- `<out>/rules/balanced/<list>.yaml`
- `<out>/rules/full/<list>.yaml`
- `<out>/resolved/<list>.json`
- `<out>/stats/global.json`
- `<out>/stats/lists/<list>.json`

`balanced` is the default serving mode.
