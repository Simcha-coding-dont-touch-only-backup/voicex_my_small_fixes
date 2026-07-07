# Handoff: Per-product Custom Markup (%)

**From:** Samuel · **For:** Simcha
**What this is:** a finished, builds-and-tests-clean feature. Below: what it does, the
one database step, how to apply the code, and a decision to confirm.

---

## 1. What it does (the intent)

On the **Products → Edit Product** form there's a new field **"Custom Markup (%)"**, right
after *Custom Price (cents)*.

**How a product's VoiceX price is decided (precedence, top wins):**
1. **Custom Price** (exact cents) is set → use it.
2. Else **Custom Markup %** (this product) is set → `Amazon price × (1 + markup/100)`.
3. Else → the **global default markup** (`default_markup_percent`).

Leave the field blank to fall back to the global default (the placeholder shows the
current default, e.g. `10 (default)`).

---

## 2. ⚠️ One pricing decision to confirm before going live

There is already a **per-*user* markup** (e.g. a user set to 3%). This feature makes a
**per-product markup override a per-user markup** — i.e. if a product has Custom Markup 20%,
a 3%-rate user pays 20% on that product. This is documented and locked by a unit test
(`a per-product custom_markup_percent overrides a per-user markup`).

**If you'd rather the per-user rate win, tell me and it's a one-line change** (in
`getProductPriceCents`). Please confirm this is the behavior you want before merging.

Whitelisted users are unaffected — they still pay the Amazon price with no markup.

---

## 3. Run the ONE database step (you, via Supabase MCP)

Per `.cursor/rules/supabase-migrations.mdc`, apply via the Supabase MCP (not `db push`).
Adds a nullable column:

```sql
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS custom_markup_percent NUMERIC;

COMMENT ON COLUMN catalog_products.custom_markup_percent IS
  'Per-product markup % applied to Amazon price when custom_price_cents is null; overrides default_markup_percent. Null = use global default.';
```
Then save it locally under `supabase/migrations/<timestamp>_catalog_custom_markup_percent.sql`
with the MCP-assigned timestamp (the file in the patch uses a placeholder timestamp).

**Order matters:** the column is nullable and defaults to null, so existing products keep
today's pricing exactly until someone sets a markup. Safe to run before or after the code deploy.

---

## 4. Apply the code

**Patch:** `custom-markup-feature.patch` — `git apply custom-markup-feature.patch`, or hand it
to Cursor's AI ("apply this patch").

**Files touched (6):**
| File | Change |
|---|---|
| `supabase/migrations/…_catalog_custom_markup_percent.sql` | **new** — the column |
| `packages/shared/src/types/catalog.ts` | add `custom_markup_percent` + apply it in `getProductPriceCents` |
| `packages/shared/src/cart-pricing.test.ts` | 3 new tests documenting the precedence |
| `apps/api/src/modules/admin/catalog.ts` | accept/save the field; re-run activation + alert checks when it changes |
| `apps/api/src/modules/admin/dashboard.ts` | keep the best-sellers type valid (uses default markup — see note) |
| `apps/admin-web/src/pages/ProductsPage.tsx` | the "Custom Markup (%)" field + save |

**Known small limitation:** the **Dashboard best-sellers** "markup price" uses the *default*
markup (its DB function doesn't return the per-product markup yet). It's an internal metric,
not customer pricing. Wiring it through means updating the `get_admin_dashboard_order_stats`
RPC — a separate follow-up if you want it exact.

No new npm dependencies.

---

## 5. Test it safely BEFORE it touches customers

1. On a **branch** (not main), run the database step.
2. Let the branch build a **preview deploy**.
3. On the preview: edit a product → set **Custom Markup = 20** → save → confirm the VoiceX
   price shows Amazon + 20%. Clear it → confirm it returns to the default.
4. Check a **cart / test call** for that product to confirm the price the customer would pay.
5. Merge to `main` only once it's right — and after you've confirmed the section-2 decision.

---

## 6. Build check already done

`@voicex/shared` builds ✅ · **16/16 tests pass** ✅ · `@voicex/api` builds ✅ · `@voicex/admin-web` builds ✅
