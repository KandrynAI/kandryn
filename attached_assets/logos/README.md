# blue mantis — logo colour variants

Rebuilt from the uploaded PNG as clean vector paths, then recoloured. All assets have a
transparent background.

## What's here

| Folder | Contents |
|---|---|
| `svg/` | Full lockup (mark + wordmark), scalable, 312 × 76 viewBox |
| `png/` | Full lockup, 2400 px wide, transparent PNG |
| `mark-svg/` | Icon only (the M mark), 117 × 76 viewBox — for avatars, favicons, app icons |
| `mark-png/` | Icon only, 1200 px wide, transparent PNG |
| `preview.html` | Contact sheet of every variant |

## Variants

| # | Name | Hex | Use |
|---|---|---|---|
| 01 | Signal blue | `#076DF2` | Original — primary brand mark |
| 02 | Midnight navy | `#0A1F44` | Documents, letterhead, formal decks |
| 03 | Black | `#000000` | One-colour print, stamps, engraving |
| 04 | White | `#FFFFFF` | Reversed on dark backgrounds/photography |
| 05 | Slate grey | `#64748B` | Muted footers, partner walls, watermarks |
| 06 | Electric cyan | `#00B8D4` | Dark UI, terminal/dev-tool contexts |
| 07 | Deep teal | `#0D9488` | Secondary accent |
| 08 | Emerald | `#10B981` | Status/success contexts |
| 09 | Violet | `#7C3AED` | AI/product sub-brand |
| 10 | Magenta | `#DB2777` | Campaign/event use |
| 11 | Crimson | `#E11D48` | High-attention, alerts |
| 12 | Amber orange | `#F97316` | Warm contrast against the blue |
| 13 | Antique gold | `#C9A227` | Awards, anniversary, premium tier |
| 14 | Duo — blue mark / navy type | `#076DF2` + `#0A1F44` | Print-friendly two-colour |
| 15 | Duo — cyan mark / white type | `#00B8D4` + `#FFFFFF` | Dark backgrounds |
| 16 | Duo — orange mark / near-black type | `#F97316` + `#111111` | Light backgrounds, high contrast |

## Notes

- SVGs use `fill-rule="evenodd"`, so the triangle notch in the mark stays hollow at any size.
- Need a different colour? The SVG has exactly two `fill` attributes — swap the hex and you're done.
- Clear space: keep at least the height of the mark's triangle notch on all sides.
- Below roughly 24 px tall the wordmark stops being legible — use the mark-only files there.
