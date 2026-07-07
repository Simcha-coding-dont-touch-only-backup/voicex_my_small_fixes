# Voicex Baby Essentials — Web Catalog Editor

A **web version of the printed "Baby Essentials" PDF catalog** that you control
yourself. Instead of a fixed PDF, this is an editable web page: change prices,
swap product photos, make images bigger or smaller, remove items, add items, and
reorganize sections — then print or save it back to PDF whenever you want.

## How to use it

**Just open `index.html` in any web browser** (double-click the file, or drag it
into Chrome/Safari/Edge). No install, no internet, no server needed — everything
runs in the browser and your changes save automatically on your computer.

### What you can do

| Action | How |
|--------|-----|
| **Edit a price / name / product #** | Click the text and type. Press Enter or click away to keep it. |
| **Add a "was" price** (strikethrough) | Click **+was** under a price, then edit both numbers. |
| **Add a gold SAVE badge** | Click **+ save badge**, then edit the amount. |
| **Swap a product photo** | Hover the product → **🖼 Swap** → pick an image from your computer. |
| **Make a photo bigger / smaller** | Hover the product → **－** / **＋**. |
| **Remove an item** | Hover the product → **🗑**. |
| **Duplicate an item** | Hover the product → **⧉**. |
| **Add an item** | Click **+ Add product** in a section (or the dashed box at the end of a section). |
| **Add / remove a section** | **+ Add new section** at the bottom; **Remove section** in a section header. |
| **Manage "Also available" variants** | **+ variant** on a product; **✕** to remove one. |

### Top toolbar

- **✎ Edit / 👁 Preview** — switch between editing and a clean view that looks like
  the final catalog (use Preview before printing).
- **🖨 Print / Save PDF** — opens your browser's print dialog; choose *Save as PDF*
  to get a fresh PDF of your edited catalog.
- **⬇ Backup** — downloads a `.json` file with your whole catalog. Keep this safe.
- **⬆ Restore** — load a backup `.json` file back in.
- **↺ Reset** — throw away your edits and go back to the original PDF version.

## Important notes

- Your edits are stored **in this browser on this computer** (via `localStorage`).
  If you switch computers/browsers or clear browsing data, use **Backup** first and
  **Restore** on the other machine.
- Swapped images are stored inside the catalog too, so backups are fully
  self-contained.

## Files

- `index.html` — the whole app (self-contained; product data and images are embedded).
- `catalog-data.json` — the original catalog data (7 categories, 70 products, prices,
  variants, and images) extracted from the source PDF. This is the seed the editor
  starts from; you don't need to touch it.

The original catalog contained 7 sections — Diapers, Pull-Ups & Training Pants,
Wipes & Disposal, Bath/Body & Skin Care, Pacifiers, Feeding & Mealtime, and
Diaper Rash & Health.
