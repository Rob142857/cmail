# Branding and first customisation

cmail ships neutral fallback assets so a new deployment is usable immediately. Override branding through environment variables rather than editing application code:

| Variable | Purpose |
|---|---|
| `APP_NAME` | Product name in page titles and the installable manifest |
| `ORG_NAME` / `ORG_SHORT_NAME` | Organisation names used in interface copy |
| `BRAND_LOGO_URL` | Horizontal sign-in and header logo |
| `BRAND_ICON_URL` | Square browser/PWA icon |
| `BRAND_OG_IMAGE_URL` | Social sharing image; use a 1200×630 image |
| `BRAND_PRIMARY_COLOR` | Six-digit hexadecimal interface accent |

Asset URLs may be root-relative paths served by the web application or HTTPS URLs on an operator-controlled CDN. Production social-image metadata is resolved against `APP_URL` so crawlers receive an absolute URL.

The fallback assets live in `apps/web/static`: `favicon.svg`, `icon.svg`, `logo.svg`, and `og-image.svg`, with 192- and 512-pixel PNG icons for install surfaces. Keep adequate contrast, meaningful image dimensions, and equivalent light/dark behavior when replacing them.

Environment values are the portable default. Keep organisation-specific files and private CDN credentials out of the public repository.

[← Documentation home](README.md)
