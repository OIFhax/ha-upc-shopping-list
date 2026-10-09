# UPC Shopping List Scanner for Home Assistant

Scan a UPC, EAN, or GTIN with the Home Assistant Companion app and add the
resolved product name to Home Assistant's standard `todo.shopping_list`.

The card checks a shared catalog stored on your own Home Assistant server,
falls back to [Open Food Facts](https://world.openfoodfacts.org/), and asks for
a name when a product is unknown. A name entered by one Home Assistant user is
available to the next user who scans that barcode.

## Features

- Uses the native Companion app barcode scanner when it is available.
- Provides manual barcode entry in desktop browsers and other clients.
- Adds products to the default Home Assistant Shopping List.
- Shares learned product names between users of the same Home Assistant server.
- Accepts UPC-E, UPC-A, EAN-13, and GTIN-14 values.
- Requires no API key or cloud account beyond your existing Home Assistant
  installation.
- Lets each card target another to-do entity or use another Open Food Facts
  country and language.

## Prerequisites

- A recent Home Assistant release with the Shopping List and Local To-do
  integrations.
- The Home Assistant Companion app for native camera scanning. The card still
  supports manual entry without the Companion app.
- HTTPS or another secure Home Assistant connection if required by your mobile
  platform for camera access.
- [HACS](https://www.hacs.xyz/) is optional; the frontend can also be installed
  manually.

## Installation

Installation has two parts: the backend package, which performs lookups and
updates the lists, and the dashboard card, which provides the scanner UI. HACS
installs the dashboard card only.

### 1. Confirm the default Shopping List

Open **Settings > Devices & services** in Home Assistant and add the
**Shopping list** integration if it is not already configured. Confirm that its
entity ID is `todo.shopping_list` under **Developer tools > States**.

### 2. Create the local UPC catalog

1. Open **Settings > Devices & services > Add integration**.
2. Search for and add **Local to-do**.
3. Name the list `UPC Lookup Catalog`.
4. Confirm that Home Assistant created `todo.upc_lookup_catalog` under
   **Developer tools > States**. If Home Assistant chose a different entity ID,
   use that ID in the card configuration below.

The catalog is an implementation detail, so you may hide it from automatically
generated dashboards in the entity settings.

### 3. Install the backend package

Copy [`packages/upc-shopping-list.yaml`](packages/upc-shopping-list.yaml) to:

```text
/config/packages/upc-shopping-list.yaml
```

Enable packages in `configuration.yaml` if they are not already enabled:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

If your configuration already has a `homeassistant:` section, add only the
`packages:` line beneath that existing section. Check the configuration, then
restart Home Assistant. After the restart,
`script.upc_lookup_add_item` should appear under **Developer tools > States**.

### 4. Install the dashboard card with HACS

Until this repository is included in HACS by default, add it as a custom
repository:

1. Open **HACS > Dashboard**.
2. Open the menu and choose **Custom repositories**.
3. Add `https://github.com/OIFhax/ha-upc-shopping-list` with category
   **Dashboard**.
4. Find **UPC Shopping List Scanner** in HACS and download it.
5. Reload the browser or Companion app frontend.

HACS normally adds the dashboard resource automatically. If it does not, add a
JavaScript module resource with this URL:

```text
/hacsfiles/ha-upc-shopping-list/ha-upc-shopping-list.js
```

### Manual dashboard installation

Copy [`dist/ha-upc-shopping-list.js`](dist/ha-upc-shopping-list.js) to:

```text
/config/www/ha-upc-shopping-list.js
```

Then add a JavaScript module under **Settings > Dashboards > Resources**:

```text
/local/ha-upc-shopping-list.js
```

If the same URL was already loaded, append a version query while testing, such
as `/local/ha-upc-shopping-list.js?v=1.0.0`, to bypass a stale cache.

## Dashboard configuration

The defaults use `todo.shopping_list` and `todo.upc_lookup_catalog`, so the
smallest valid card is:

```yaml
type: custom:upc-shopping-list-card
```

The complete configuration is:

```yaml
type: custom:upc-shopping-list-card
entity: todo.shopping_list
catalog_entity: todo.upc_lookup_catalog
script: script.upc_lookup_add_item
list_name: Shopping List
country_code: us
language_code: en
```

| Option | Default | Description |
| --- | --- | --- |
| `entity` | `todo.shopping_list` | To-do entity that receives scanned products. |
| `catalog_entity` | `todo.upc_lookup_catalog` | Local To-do entity holding learned GTIN-to-name mappings. |
| `script` | `script.upc_lookup_add_item` | Backend script called by the card. |
| `list_name` | `Shopping List` | Friendly list name shown in status messages. |
| `country_code` | `us` | Two-letter country used for Open Food Facts results. |
| `language_code` | `en` | Two-letter language preferred for product names. |

Use lowercase ISO country and language codes for the best Open Food Facts
results.

## How lookup and learning work

1. The scanned value is normalized to a 14-digit GTIN for catalog matching.
2. The backend checks `todo.upc_lookup_catalog` first.
3. If the product is not in the local catalog, it queries Open Food Facts.
4. If no public result is available, the card asks the user for a product name.
5. A user-supplied name is stored in the local catalog and the product is added
   to `todo.shopping_list`.

The local catalog uses the GTIN as the to-do item summary and the product name
as its description. Do not manually change that format unless you intend to
repair or replace an entry.

## Privacy

Learned barcode mappings remain in the Local To-do integration on your Home
Assistant server. They are shared only with users of that Home Assistant
instance and are covered by your normal Home Assistant backup strategy. They
are not committed to this repository or uploaded to Open Food Facts.

For barcodes not already learned locally, the backend sends the barcode and the
configured country/language codes to the public Open Food Facts API. It does
not send Home Assistant credentials, usernames, device identifiers, or shopping
list contents.

## Troubleshooting

### The card shows “Configuration error”

- Confirm the resource is loaded as a **JavaScript module**.
- Confirm the URL is `/hacsfiles/ha-upc-shopping-list/ha-upc-shopping-list.js`
  for HACS or `/local/ha-upc-shopping-list.js` for a manual installation.
- Hard-refresh the browser. In the Companion app, use its **Reset frontend
  cache** option, fully close the app, and reopen it.

### The Scan button opens manual entry

Native camera scanning is exposed by the Home Assistant Companion app. Normal
desktop and mobile browsers use manual entry. Also confirm the Companion app
has camera permission.

### Every lookup fails

- Confirm `script.upc_lookup_add_item`, `todo.shopping_list`, and
  `todo.upc_lookup_catalog` exist.
- Check **Settings > System > Logs** for package or REST command errors.
- Confirm the Home Assistant host can reach `world.openfoodfacts.org` over
  HTTPS.

### A product is not found

Open Food Facts is community maintained and does not contain every barcode.
Enter a useful product name when prompted. The server will remember it for all
users on the next scan.

## Open Food Facts attribution

Product information is provided by
[Open Food Facts](https://world.openfoodfacts.org/), a community-created food
products database. Open Food Facts database content is available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
Product availability and naming are controlled by that upstream dataset.

## License

The source code in this repository is licensed under the [MIT License](LICENSE).
Open Food Facts data remains subject to its own license.
