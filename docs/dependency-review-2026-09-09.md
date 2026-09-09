# Staff sign-in release dependency review

This focused repair retains pnpm 11.18.0, Wrangler 4.118.0, and the existing
Node engine/CI support (Node 22 and 24). No identity or deployment dependency
was added. The repository's ordinary frozen installation remains required.

| Finding | Reviewed repair | Scope |
| --- | --- | --- |
| [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) | Vitest and matching internal packages 4.1.10 → 4.1.11 | Two audit entries: Vitest and its mocker. Development-server file disclosure; both workspace test runners now pin the patched release. |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | Sharp 0.35.2 → 0.35.4, packaged libvips 1.3.1 → 1.3.3 | Native image-library advisory in Wrangler's local Miniflare dependency. An exact `miniflare>sharp` override replaces the previous global floating override. |

Registry metadata dates the selected Vitest release to 2026-08-18 and Sharp
to 2026-08-26; no release-age exception is needed. Maintainer usernames,
upstream repositories, MIT/Apache-2.0 licensing, and Node engine requirements
are unchanged. Both manifests advertise registry signatures and provenance
attestations; metadata presence is not an independent cryptographic audit.
The lockfile uses registry SHA-512 integrity values. Updated package
integrities are checked against public registry metadata during this review.

The reviewed manifests introduce no install lifecycle scripts. Sharp uses
platform-specific prebuilt/native packages; its former broad build approval
is removed and version 0.35.4 is explicitly denied. Existing unrelated build
decisions remain unchanged. No new package family, remote Git dependency, or
install-time downloader is introduced. The lockfile also deduplicates
picomatch onto the already-locked 4.0.5 and refreshes optional peer contexts;
unrelated direct dependency versions stay unchanged.

Engineering maintains the exact Sharp override until a reviewed Miniflare
release selects a patched compatible Sharp itself. Remove it only after
frozen installation and actual native image checks pass. Future Sharp updates
must update the exact assertion in the image-runtime check deliberately.

Validation commands are `pnpm install --frozen-lockfile` and
`pnpm run release:check` (full validation plus the history secret scan).
`pnpm run test:image-runtime`, included in validation, encodes/decodes and
resizes synthetic PNG/AVIF data through Sharp and the local Miniflare Images
binding. No live mail, remote Images service, credentials, or fixtures are
used. Local verification does not authorize release or deployment.
