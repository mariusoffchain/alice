# Alice brand

D2, the continuous spiral, was selected on 2026-10-06. `alice-symbol.svg` is the approved symbol on a 48 × 48 grid. `alice-wordmark.svg` combines that symbol as the A with LICE; do not prepend it to a second full ALICE wordmark.

The rabbit remains the assistant mascot in chat and illustrations. Mobile wallet branding is outside this update.

## Rebuild

With Node 24 and the repository dependencies installed, run from the root:

```sh
node scripts/generate-brand-assets.mjs
node apps/site/scripts/generate-og.mjs
```

The first command writes the web SVGs, favicon PNGs, touch/application icons and local TypeScript paths for site and app-web. The second regenerates the website sharing image. Components render the same vector paths inline with currentColor for theme support, without a network request or font dependency. The original vector masters are the source of truth; keep their geometry unchanged.

Use `npm run build --workspace @alice-wallet/site` and the app-web build procedure in BUILDING.md. Review the site header/footer, application sidebar, browser favicon and light/monochrome application themes. Icons at small sizes use the approved geometry without a separate simplified variant.

## Desktop previews

Run `node scripts/generate-desktop-icons.mjs` to create the rounded desktop asset and Tauri PNG, ICNS and ICO files from D2. The script uses the installed Tauri CLI in a temporary directory and copies only desktop formats. It does not modify the mobile wallet.

Private test builds are defined in `.github/workflows/desktop-preview.yml`. Brand/desktop PR changes trigger builds on macOS (universal DMG), Windows (MSI), Linux (AppImage and DEB), plus web and website exports. Jobs require a private repository and a same-repository PR. They check out the exact PR head, have read-only repository permissions, use no signing secrets, create no release or tag, and retain artifacts for 7 days. macOS uses an ad hoc signature, Windows/Linux are unsigned; these builds are for testing, not public distribution. A successful build does not establish successful installation or runtime QA.

The existing release workflow remains separate. Merge dependent update-notice work before this branding branch, or retarget its PR after that merge.
