# Dependency upgrade review — 22 September 2026

This release updates direct dependencies to the latest stable versions found
on the npm registry on the review date, including major-version migrations.
The public source remains tenant-neutral. No database migrations, resource
bindings, OAuth credentials, mail DNS, retention settings, or Cloudflare
compatibility dates are changed by the dependency upgrade.

## Toolchain

| Component | Release |
| --- | --- |
| pnpm | 12.5.1, exact package-manager pin and regenerated lockfile |
| TypeScript compiler | 7.0.2 |
| Web compiler API compatibility dependency | 6.0.3 |
| Svelte / SvelteKit | 5.57.1 / 2.70.3 |
| Svelte Vite plugin / checker | 7.3.0 / 4.7.6 |
| Vite / Vitest | 8.3.0 / 5.0.1 |
| postal-mime / mimetext | 3.0.0 / 3.0.28 |
| Wrangler / Workers types | 4.136.1 / 5.20260921.1 |
| ESLint / typescript-eslint | 10.11.0 / 8.70.1 |
| eslint-plugin-svelte / globals | 3.23.0 / 17.12.0 |
| setup-node action | 7.0.0, immutable commit pin |

Node 24 LTS is the recommended local runtime; the minimum is Node 22.12.
CI continues testing the supported Node 22 and 24 lines. Other direct
dependencies already at their latest stable release remain unchanged.

## Major-version adaptations

- **TypeScript 7:** the Worker and shared package use its native compiler.
  SvelteKit, svelte-check, and typescript-eslint still require the TypeScript
  6 compiler API. The web package therefore retains `typescript ~6.0.3` and
  installs the stable version 7 compiler under the documented
  `@typescript/native` npm alias. Its check command runs both the traditional
  Svelte checker and `svelte-check --tsgo`; this preserves existing diagnostics
  while also validating the new compiler. No peer-dependency override or
  experimental compiler API is used. See the
  [Svelte checker instructions](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check)
  and [TypeScript 7 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- **Vitest 5:** keep its default mock cleanup enabled. The Worker declares
  Vite explicitly, now a Vitest peer. Existing tests and mail-parser regression
  tests run on the new runner; no assertions are disabled for compatibility.
  See the [migration guide](https://vitest.dev/guide/migration/).
- **postal-mime 3:** first-wins duplicate single-value headers, recipient
  document order, folded names, and binary attachment data are covered by
  regression tests. Attachments remain `ArrayBuffer` values accepted by R2;
  existing mail bounds and sanitization remain in place. See the
  [upstream changelog](https://github.com/postalsys/postal-mime/blob/master/CHANGELOG.md).
- **pnpm 12:** use Corepack shims throughout the shell, including nested
  scripts. Use `allowBuilds` as the single lifecycle approval list; the
  redundant legacy `onlyBuiltDependencies` list is removed. Sharp scripts
  remain denied. The exact newly released Cloudflare and typescript-eslint
  versions are listed as release-age exceptions; the age gate is not disabled
  globally. Installs must use the committed frozen lockfile.
- **Miniflare 5 (Wrangler dependency):** the image-runtime gate now uses the
  new Worker manifest and typed environment binding configuration. It still
  exercises real PNG/AVIF transforms through the local Images implementation,
  with telemetry and remote request-metadata fetching explicitly disabled.

## Transitive dependency boundary

Do not force a framework's internal packages to unrelated major versions.
SvelteKit's cookie/devalue serialization and Cloudflare tooling's Undici
remain on their patched upstream-compatible major lines. The narrowly scoped
legacy nanoid security override remains narrow. In particular, cookie 2,
devalue 6, Undici 8, and nanoid 6 are not globally substituted for dependencies
whose consumers have not migrated. These are not direct cmail dependencies.

The existing Sharp 0.35.4 exact override remains (also the latest stable
release at review time); the PNG/AVIF and Miniflare Images runtime checks
remain required. esbuild, PostCSS, and ws overrides advance to current
compatible patches. No production runtime date is advanced implicitly.

## Release verification

Run `pnpm install --frozen-lockfile`, `pnpm peers check`, and
`pnpm release:check`. The release gate covers secret scanning, landing assets,
binding isolation, lint, both compiler paths, tests, native image operations,
fresh and upgrade-path D1 migrations, production build, vulnerability audit,
and reachable Git history. CI repeats these checks on Node 22 and 24.

For each existing deployment, preserve its ignored Wrangler configuration
and secrets; record the prior Pages deployment and Worker version; confirm
there are no pending migrations; deploy Worker before Pages; then verify
the sign-in page, provider redirects, protected-route access boundaries,
manifest, service worker, and immutable assets. A successful HTTP check is
not proof of delivery to an external mailbox or a mobile push notification.

[Back to documentation](README.md)
