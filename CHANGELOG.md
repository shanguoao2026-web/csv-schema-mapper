# Changelog

## 0.1.0 — 2026-11-02

Initial release.

- Commands: `map`, `suggest`, `validate`, `list-targets`
- Built-in targets: HubSpot contacts, Shopify customers, Shopify products, Xero contacts
- YAML and JSON mapping configs with explicit columns, chained transforms, and optional auto-match
- Fuzzy header matching (normalize, synonyms, Damerau–Levenshtein) and a non-interactive suggest mode
- JSON and HTML validation reports with per-column confidence, missing required fields, type errors, and sample bad rows
- Transforms: `trim`, `lower`, `upper`, `phone_e164_loose`, `date_iso_loose`
