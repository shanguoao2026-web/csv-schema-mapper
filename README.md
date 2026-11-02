# csv-schema-mapper

Non-interactive CLI that maps a messy client CSV onto a target schema. Built-in targets cover HubSpot contacts, Shopify customers, Shopify products, and Xero contacts. Bring your own schema with `--target custom --schema`.

It does three jobs:

1. Apply a YAML or JSON mapping config (explicit renames and transforms).
2. Fuzzy-match headers when `auto: true`, or when you run `map` without a config. Matching normalizes case and punctuation, checks synonyms, then uses Damerau–Levenshtein.
3. Write the mapped CSV plus a JSON or HTML report: missing required fields, type mismatches, sample bad rows, and per-column confidence.

There are no prompts.

## Install

Node.js 18 or newer.

```bash
npm install
npm run build
node dist/cli.js list-targets
```

After `npm link`, the `csv-schema-mapper` command is on your PATH. The package name and the bin name are both `csv-schema-mapper`.

## Commands

```bash
csv-schema-mapper map \
  --in messy.csv \
  --target hubspot-contacts \
  --config mapping.yaml \
  --out out.csv \
  --report report.html

csv-schema-mapper suggest --in messy.csv --target hubspot-contacts
csv-schema-mapper validate --in out.csv --target hubspot-contacts
csv-schema-mapper list-targets
```

| Command | What it does |
| --- | --- |
| `map` | Read the CSV, apply the config, write `--out`. Optional `--report` (`.html` or `.json`). |
| `suggest` | Print a mapping YAML to stdout. Does not write data files. |
| `validate` | Check a CSV that already uses target headers (field id or output header). |
| `list-targets` | Print built-in targets. `--json` for a machine-readable list. |

`map` overwrites `--out` and `--report`. It refuses to point either path at the input file.

With no `--config`, `map` auto-matches every target field. With a config file, `auto` defaults to **false** so only the columns you listed are copied, unless the file sets `auto: true`.

`suggest` always fills gaps, then prints `auto: false` so the YAML you save is explicit. Redirect it:

```bash
csv-schema-mapper suggest --in messy.csv --target hubspot-contacts > mapping.yaml
```

### Flags

| Flag | Meaning |
| --- | --- |
| `-i, --in` | Input CSV |
| `-o, --out` | Mapped CSV (`map` only) |
| `-t, --target` | `hubspot-contacts`, `shopify-customers`, `shopify-products`, `xero-contacts`, or `custom` |
| `-s, --schema` | YAML or JSON schema. Required when `--target custom` |
| `-c, --config` | YAML or JSON mapping |
| `-r, --report` | Report path. Format comes from `.html`, `.htm`, or `.json` |
| `-f, --format` | `html` or `json` when the report path has another extension |
| `-d, --delimiter` | Force the input delimiter. Default detects comma, semicolon, tab, or pipe from the header row. `tab` and `\t` mean tab |
| `--json` | `list-targets` prints JSON |
| `-h, --help` | Help |
| `-V, --version` | Version |

Output CSVs are comma-separated UTF-8 with `\n` newlines. Input may be comma, semicolon, tab, or pipe. Blank lines are skipped. Header matching ignores case, accents, and punctuation, so `First_Name` and `First Name` are the same header and a file cannot contain both.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. `map` and `validate` found no errors. Warnings do not change the code. |
| 1 | Validation errors. `map` still writes the CSV and the report. |
| 2 | Usage error, unreadable file, unknown target, or invalid config. No output file is written. |

`suggest` and `list-targets` exit 0 when they print a result, and 2 on usage errors. A suggested file can still leave required fields unmapped; that shows up as YAML comments, not a failed exit. Running `map` on that file then exits 1.

## Mapping config

```yaml
target: hubspot-contacts
auto: true
required_from_target: true
columns:
  email: "Email Address" # source header, no transform
  firstname: { source: "First", transform: trim }
  lastname:
    source: "Last Name"
    transform: [trim]
# Optional pipeline applied to every mapped cell after the column transform.
transforms: [trim]
```

| Key | Meaning |
| --- | --- |
| `target` | Schema id. Must match `--target` when both are set (`custom` is allowed as a placeholder). |
| `auto` | Fill target fields you did not list. Default `false` when a config file is present, `true` when it is not. |
| `required_from_target` | When `true` (default), a required field with no source is an error. When `false`, it is a warning. |
| `columns` | Map of target field id (output header and label also work) to a source header or `{ source, transform }`. |
| `transforms` | Global pipeline: one name or a YAML list. Runs after the column transform. |

A pipe-separated list of **every** built-in transform is treated as a vocabulary note, not a pipeline (chaining `lower` and `upper` would destroy values):

```yaml
transforms: trim | lower | upper | phone_e164_loose | date_iso_loose
```

That line is accepted and ignored, and the report includes a warning. To actually chain transforms, use `[trim, lower]`. A shorter pipe list such as `trim | lower` is applied in that order.

Column keys are field ids. For Shopify and Xero you can also use the output header (`Email`, `ContactName`). Unknown fields and a source column listed twice are errors (exit 2).

`suggest` output is valid config. Confidence is a comment, so you can pass the file back to `map`.

## Transforms

| Name | Effect |
| --- | --- |
| `trim` | Trim whitespace |
| `lower` | Lowercase |
| `upper` | Uppercase |
| `phone_e164_loose` | Strip formatting and a trailing extension. 10-digit numbers become `+1…` (NANP). 11-digit numbers starting with `1` get `+`. A leading `+` or `00` is kept as `+`. Other 8–15 digit values get `+` and must already include a country code. Shorter values are left unchanged so validation can flag them. |
| `date_iso_loose` | Write `YYYY-MM-DD`. Accepts ISO datetimes, `YYYY/MM/DD`, `MM/DD/YYYY`, `DD/MM/YYYY` when one side is `> 12`, and month names (`Jan 1, 2020`, `01-Jan-2020`). Ambiguous numeric dates use month/day/year. Two-digit years: 00–69 → 2000s, 70–99 → 1900s. Unparseable text is unchanged. |

`suggest` proposes a default per type (`email` → `trim` + `lower`, `phone` → `phone_e164_loose`, `date` → `date_iso_loose`, everything else → `trim`). Plain `map --auto` does **not** apply those defaults; put them in the config if you want them.

## Fuzzy matching

Headers are normalized: lowercase, accents removed, punctuation and `_` / `-` become spaces.

A header then scores against each target field's id, output header, label, and synonyms:

| Score | How |
| --- | --- |
| 1.00 exact | Normalized id, header, or label |
| 1.00 synonym | Normalized synonym |
| 0.99 | Same words, different order |
| 0.93 | Field label plus a generic tail such as `name` or `code` (`City Name` → `city`) |
| 0.90 | One adjacent typo when both strings are at least 4 characters (`Frist Name` → `first name`) |
| else | `1 - distance / max(length)` using Damerau–Levenshtein (adjacent transpositions count as one edit) |

Auto-map and suggest keep scores **≥ 0.86**. Each source column is used at most once; the highest score wins. Fuzzy matches **below 0.92** are warnings (`low_confidence`) and do not fail the run by themselves.

`validate` does not fuzzy-match. It only accepts the field id, output header, or label. Client headers such as `Email Address` fail validation against HubSpot until you `map` them.

## Reports

`--report report.html` or `--report report.json`.

The report includes the target, row counts, the column match table (source, method, confidence, transforms), every issue, and up to eight sample bad rows. `map` prints a short summary on stdout and the first issues on stderr. `row` is the 1-based data row in the output (blank input lines are not counted).

Issue codes:

| Code | Level | Meaning |
| --- | --- | --- |
| `missing_required` | error, or warning if `required_from_target` is false | Required field has no source column |
| `missing_source` | error | Config names a header that is not in the file |
| `empty_required` | error | Mapped required cell is blank |
| `type_mismatch` | error | Non-empty value does not match the field type |
| `low_confidence` | warning | Fuzzy score under 0.92 |
| `unmapped_source` | warning | Input column was not used |
| `unknown_column` | warning | `validate` saw a header that is not on the schema |
| `extra_values` | warning | A row had extra non-empty cells |
| `empty_input` | warning | Header only |
| `transforms_note` | warning | The pipe-separated vocabulary sketch was ignored |

Types:

| Type | Accepts |
| --- | --- |
| `string` | Any value |
| `email` | `local@domain.tld`, no spaces |
| `phone` | 8–15 digits, optional leading `+`, light punctuation ignored |
| `date` | `YYYY-MM-DD` or an ISO datetime on a real calendar day |
| `number` | Optional `$` `£` `€` `¥` and thousands commas |
| `integer` | Whole number, same currency and comma rules |
| `boolean` | `true/false`, `yes/no`, `y/n`, `t/f`, `1/0` |
| `url` | `http(s)://…`, `www.…`, or a bare domain |
| `enum` | One of the schema values, compared case-insensitively with spaces, `_`, and `-` removed |

Empty cells skip the type check. Required empty cells use `empty_required` instead.

## Built-in targets

Field **id** is what you write in `columns:`. **Header** is the column name in the mapped CSV. Synonym lists live in [`schemas/`](schemas/).

### HubSpot contacts — `hubspot-contacts`

Output headers are HubSpot internal property names. Required: `email`.

| id | header | type |
| --- | --- | --- |
| email | email | email, required |
| firstname | firstname | string |
| lastname | lastname | string |
| phone | phone | phone |
| mobilephone | mobilephone | phone |
| company | company | string |
| website | website | url |
| jobtitle | jobtitle | string |
| address | address | string |
| city | city | string |
| state | state | string |
| zip | zip | string |
| country | country | string |
| lifecyclestage | lifecyclestage | enum: subscriber, lead, marketingqualifiedlead, salesqualifiedlead, opportunity, customer, evangelist, other |
| hs_lead_status | hs_lead_status | string |
| createdate | createdate | date |

```bash
node dist/cli.js map \
  --in fixtures/hubspot/messy.csv \
  --target hubspot-contacts \
  --config fixtures/hubspot/mapping.yaml \
  --out /tmp/hubspot.csv \
  --report /tmp/hubspot.html
```

That fixture is supposed to exit **1**. It has a bad email, a short phone, a bad URL, an impossible date, and a blank email. `fixtures/hubspot/clean.csv` validates with exit 0:

```bash
node dist/cli.js validate --in fixtures/hubspot/clean.csv --target hubspot-contacts
```

### Shopify customers — `shopify-customers`

Output headers match the Shopify customer CSV. Required: `email`.

| id | header | type |
| --- | --- | --- |
| first_name | First Name | string |
| last_name | Last Name | string |
| email | Email | email, required |
| accepts_email_marketing | Accepts Email Marketing | boolean |
| company | Company | string |
| address1 | Address1 | string |
| address2 | Address2 | string |
| city | City | string |
| province | Province | string |
| province_code | Province Code | string |
| country | Country | string |
| country_code | Country Code | string |
| zip | Zip | string |
| phone | Phone | phone |
| accepts_sms_marketing | Accepts SMS Marketing | boolean |
| total_spent | Total Spent | number |
| total_orders | Total Orders | integer |
| tags | Tags | string |
| note | Note | string |
| tax_exempt | Tax Exempt | boolean |

```bash
node dist/cli.js map \
  --in fixtures/shopify-customers/messy.csv \
  --target shopify-customers \
  --config fixtures/shopify-customers/mapping.yaml \
  --out /tmp/shopify-customers.csv \
  --report /tmp/shopify-customers.json
```

Boolean cells are checked, not rewritten. Shopify often wants `yes` / `no`; put that text in the source or add your own cleanup before import.

### Shopify products — `shopify-products`

Core product columns (not the Google Shopping tail). Required: `handle`, `title`. `status` is `active`, `draft`, or `archived`.

| id | header | type |
| --- | --- | --- |
| handle | Handle | string, required |
| title | Title | string, required |
| body_html | Body (HTML) | string |
| vendor | Vendor | string |
| product_category | Product Category | string |
| type | Type | string |
| tags | Tags | string |
| published | Published | boolean |
| option1_name | Option1 Name | string |
| option1_value | Option1 Value | string |
| option2_name | Option2 Name | string |
| option2_value | Option2 Value | string |
| option3_name | Option3 Name | string |
| option3_value | Option3 Value | string |
| variant_sku | Variant SKU | string |
| variant_grams | Variant Grams | integer |
| variant_inventory_qty | Variant Inventory Qty | integer |
| variant_price | Variant Price | number |
| variant_compare_at_price | Variant Compare At Price | number |
| variant_barcode | Variant Barcode | string |
| image_src | Image Src | url |
| status | Status | enum |

```bash
node dist/cli.js suggest --in fixtures/shopify-products/messy.csv --target shopify-products
```

### Xero contacts — `xero-contacts`

Common contact-import columns. Required: `contact_name` (`ContactName`). Email is optional and, when present, must look like an email.

| id | header | type |
| --- | --- | --- |
| contact_name | ContactName | string, required |
| account_number | AccountNumber | string |
| email | EmailAddress | email |
| first_name | FirstName | string |
| last_name | LastName | string |
| po_attention_to | POAttentionTo | string |
| po_address_line1 | POAddressLine1 | string |
| po_address_line2 | POAddressLine2 | string |
| po_city | POCity | string |
| po_region | PORegion | string |
| po_postal_code | POPostalCode | string |
| po_country | POCountry | string |
| phone | PhoneNumber | phone |
| mobile | MobileNumber | phone |
| fax | FaxNumber | phone |
| tax_number | TaxNumber | string |
| website | Website | url |

```bash
node dist/cli.js map \
  --in fixtures/xero/messy.csv \
  --target xero-contacts \
  --config fixtures/xero/mapping.yaml \
  --out /tmp/xero.csv \
  --report /tmp/xero.html
```

`Name` and `Company` auto-match `contact_name`, not the person-name fields. Map `first_name` explicitly when the export uses a generic name column for a person.

## Custom schema

```yaml
id: acme-leads
name: Acme Leads
description: Optional.
fields:
  - id: email
    header: Email # column in the mapped CSV; defaults to id
    label: Email # used for fuzzy match and validate
    type: email # string, email, phone, date, number, integer, boolean, url, enum
    required: true
    synonyms: [email address, e-mail]
  - id: full_name
    header: Full Name
    type: string
    required: true
    synonyms: [name, full name]
  - id: score
    header: Score
    type: integer
    synonyms: [lead score, points]
```

```bash
node dist/cli.js map \
  --in fixtures/custom/messy.csv \
  --target custom \
  --schema fixtures/custom/schema.yaml \
  --config fixtures/custom/mapping.yaml \
  --out /tmp/acme.csv \
  --report /tmp/acme.json
```

JSON schemas and JSON configs work anywhere a YAML file is accepted (use a `.json` extension).

## Library

The package is ESM. `main` returns `{ code, stdout, stderr }` and does not call `process.exit` (the bin does).

```js
import { loadBuiltin, loadMappingFile, mapCsvText, toCsv } from "csv-schema-mapper";
import { readFileSync } from "node:fs";

const schema = loadBuiltin("hubspot-contacts");
const config = loadMappingFile("mapping.yaml");
const result = mapCsvText(readFileSync("messy.csv", "utf8"), schema, config);
process.stdout.write(toCsv(result.outputHeaders, result.rows));
process.exit(result.summary.ok ? 0 : 1);
```

## Development

```bash
npm test
```

Tests use `node:test`, stay offline, and read the fixtures in [`fixtures/`](fixtures/). `npm test` compiles `dist/` (the bin) and `dist-test/` (the tests).

## License

MIT. See [LICENSE](LICENSE).
