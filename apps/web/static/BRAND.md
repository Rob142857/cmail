# cmail brand assets

All assets are SVG-only — they scale perfectly, render inline, and add zero
runtime weight.

| File | Size | Use |
|---|---|---|
| `favicon.svg` | 32×32 | browser tab icon (referenced in `app.html`) |
| `icon.svg` | 64×64 | square mark — sidebars, PWA, app stores |
| `logo.svg` | 480×120 | horizontal lockup — landing page, README |
| `og-image.svg` | 1200×630 | social card — open graph, twitter, GitHub README |

## Palette

| Token | Hex | Use |
|---|---|---|
| Primary | `#0078D4` | Microsoft Fluent blue, mark fill |
| Primary deep | `#106EBE` | bottom edge, hover states |
| Primary darker | `#005A9E` | borders, focus rings |
| Accent | `#50E6FF` | notification dots, highlights |
| Mid | `#2B88D8` | gradients |
| Surface dark | `#0A1929` | OG background |
| Ink soft | `#A6C8E5` | tagline / supporting text on dark |

## Typography

Wordmark uses the system font stack starting with **Segoe UI** (Microsoft's
default UI face) and falling back to SF Pro Display / system-ui. Weight 200
for the wordmark gives it the airy, premium feel of Fluent Design. Letter
spacing tightened to `-8` (wordmark) and `+2` (tagline).

## Generating raster versions

If you need PNG/ICO for legacy targets:

```sh
npx sharp-cli -i favicon.svg -o favicon.png resize 256 256
npx sharp-cli -i og-image.svg -o og-image.png
```
