# cmail brand assets

All assets are SVG — they scale perfectly, render inline, and add zero runtime
weight. The two PNGs exist only because the PWA manifest requires raster icons.

| File | Size | Use |
|---|---|---|
| `favicon.svg` | 32×32 | browser tab icon (referenced in `app.html`) |
| `icon.svg` | 64×64 | square mark — nav, PWA, app stores |
| `icon-192.png` / `icon-512.png` | raster | PWA manifest, Apple touch icon |
| `logo.svg` | 429×96 | horizontal lockup — landing page, README |
| `og-image.svg` | 1200×630 | social card — open graph, Twitter, GitHub README |

## The mark

A Fluent-proportioned rounded square (radius 15 on a 64 grid) carrying an open
envelope drawn in one continuous 3.6-unit stroke, with a cyan status dot
breaking the top-right corner. The dot sits clear of the flap so it never needs
a knockout ring — that ring would seam against any plate colour.

`favicon.svg` simplifies for 16px: heavier stroke, no gloss, larger dot.

## The wordmark

The letterforms are **constructed, not typeset**. Every curve is a circle of
the x-height radius, every stem is the same weight, and the whole word is one
stroke width. That means it renders identically on every OS with no webfont —
which matters here, because the app's CSP forbids remote font loading.

```
grid      baseline y=56 · x-height top y=22 · ascender y=8
stroke    6.5, round caps and joins
c         circle r17 at (20.25, 39), opened at ±38°
m         stem at x=47, two r10 shoulders → stems at 67 and 87
a         circle r17 at (117.5, 39) with a stem tangent at x=134.5
i         stem at x=150, tittle at (150, 11) r3.75
l         stem at x=165.5, ascending to y=8
```

The tittle over the "i" is the only piece of colour — the same cyan dot that
sits on the mark, so the symbol and the word read as one family.

> **Gradients must use `gradientUnits="userSpaceOnUse"`.** The stems are
> zero-width paths, and an `objectBoundingBox` gradient over a zero-width box
> is degenerate — those glyphs disappear entirely.

In the app the lockup is a component (`$lib/ui/Brand.svelte`), which draws the
wordmark when `APP_NAME` is still `cmail` and falls back to the display face
with matching tracking for whitelabel deployments.

## Palette

| Token | Hex | Use |
|---|---|---|
| Primary | `#0078D4` | Microsoft communication blue — fills, mark |
| Primary deep | `#106EBE` | hover |
| Primary darker | `#005A9E` | pressed, suite header |
| Primary darkest | `#004578` | suite header (light theme) |
| Accent | `#50E6FF` | status dot, "i" tittle |
| Mid | `#2B88D8` | gradients |
| Surface dark | `#0A1929` | OG background |
| Ink soft | `#A6C8E5` | supporting text on dark |

Brand colour is reserved for *interactive* and *selected* meaning. It is never
used as decoration.

## Regenerating the raster icons

The PNGs are rasterised from `icon.svg`:

```sh
npx sharp-cli -i icon.svg -o icon-192.png resize 192 192
npx sharp-cli -i icon.svg -o icon-512.png resize 512 512
```
