BS"D

# Test ASINs for VoiceX Product Testing

Use these ASINs when testing the **Add Product** flow in the admin portal. The system will auto-fetch name, description, and price from the Rye `products.lookup` API when an ASIN is entered.

---

## Low Price ($5–$20)

| ASIN | Product |
|------|---------|
| `B07PVCVBN8` | Amazon Basics USB-C to USB-A Cable (3 ft) |
| `B01DFKC2SO` | Amazon Basics AA Batteries (100-pack) |
| `B003YH9MMI` | Crest 3D White Toothpaste |
| `B07YFKDZ7S` | Scotch Heavy Duty Shipping Packaging Tape |

## Mid Price ($30–$100)

| ASIN | Product |
|------|---------|
| `B08N5WRWNW` | Amazon Echo Dot (4th Gen) |
| `B0BDHX8Z63` | Amazon Echo Dot (5th Gen) | = out of stock

## Higher Price ($100+)

| ASIN | Product |
|------|---------|
| `B07FZ8S74R` | Apple AirPods (2nd Gen) with Charging Case |  in stock 
| `B0932QJ2JZ` | Tile Mate Bluetooth Tracker (4-pack) |
| `B01GW3PNGT` | Kindle Paperwhite |

---

## Notes

- **Amazon Basics** and **Echo** products are Prime-eligible and reliably in-stock — good first choices.
- Test across multiple price points to verify the markup percentage logic in Settings.
- When adding a product, enter only the ASIN — name, description, and price are auto-fetched from Rye.
- Use the Rye staging endpoint for testing: `https://staging.api.rye.com/api/v1/`

--------------------------------------
B0GBWB9SB4 B0BX43H6XS B0DLMQ38PL B09W2XYSG1 B0CSF8B2BC B0DXTWLFDV B000V9LAPY B0BDHX8Z63
B0GBWB9SB4, B0BX43H6XS, B0DLMQ38PL, B09W2XYSG1, B0CSF8B2BC, B0DXTWLFDV, B000V9LAPY, B0BDHX8Z63
B0GBWB9SB4; B0BX43H6XS; B0DLMQ38PL; B09W2XYSG1; B0CSF8B2BC; B0DXTWLFDV; B000V9LAPY; B0BDHX8Z63
B0GBWB9SB4|B0BX43H6XS|B0DLMQ38PL|B09W2XYSG1|B0CSF8B2BC|B0DXTWLFDV|B000V9LAPY|B0BDHX8Z63