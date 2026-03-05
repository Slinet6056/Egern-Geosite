# @egern-geosite/core

Core library for converting geosite-style lists into Egern ruleset YAML.

## Design

The package is intentionally split into three pure stages:

1. `parser`: parse list text into typed entries (`domain/full/keyword/regexp/include`) with source locations.
2. `resolver`: apply affiliation and include graph resolution, attribute filters, dedupe and redundancy polish.
3. `egern`: emit final Egern ruleset YAML (`domain_set / domain_suffix_set / domain_keyword_set / domain_regex_set`) with regex emit report.

No filesystem or network access is required in core APIs.

## API

- `parseListText(listName, content)`
- `parseListsFromText(record)`
- `resolveAllLists(parsed)`
- `resolveOneList(parsed, listName)`
- `emitEgernRuleset(resolvedList, options)` (returns Egern ruleset YAML text)
- `buildResolvedListsFromText(record)`

Every emit call returns `report.regex` counts (`total` / `emitted`).
