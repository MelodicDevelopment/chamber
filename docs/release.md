# Releasing Chamber

Signed, notarized installers for macOS, Windows, and Linux come out of one GitHub Actions run
(`.github/workflows/release.yml`), triggered by pushing a `vX.Y.Z` tag. It is the same pipeline
Tapedeck uses: `tauri-action` on native runners, Apple notarization handled by the Tauri bundler,
Windows Authenticode through Azure Trusted Signing via `scripts/sign-windows.mjs`. Linux is not
signed; AppImage, .deb, and .rpm are uploaded as-is.

After all three builds succeed, a `publish` job writes release notes from the commit subjects since
the previous tag and publishes the draft. Nothing after the tag push is manual. Each build also
emits updater archives signed with the Chamber minisign key and a `latest.json` manifest;
installed copies (0.1.1 and later) check it on launch, download the new version in the background,
and show a "Restart to update" pill in the sidebar. `/release` in Claude Code runs the whole thing.

## One-time setup

All twelve secrets are set on the GitHub repository. They are the same Developer ID certificate
and Azure Trusted Signing account the other Melodic apps use, so nothing new needs to be bought or
validated. If a value rotates, re-set it with `gh secret set NAME --repo MelodicDevelopment/chamber`.
The Developer ID certificate expires 2027-02-01.

### macOS (sign + notarize)

1. In the Apple Developer account, make sure a **Developer ID Application** certificate exists.
   Export it with its private key from Keychain Access as a `.p12`.
2. Repository secrets:

   | Secret                       | Value                                                                 |
   | ---------------------------- | --------------------------------------------------------------------- |
   | `APPLE_CERTIFICATE`          | `base64 -i DeveloperID.p12 \| pbcopy`                                 |
   | `APPLE_CERTIFICATE_PASSWORD` | the .p12 export password                                              |
   | `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: RICHARD PAUL HOPKINS (L2SPUZJW2P)` (from `security find-identity -v -p codesigning`) |
   | `APPLE_ID`                   | the Apple ID that owns the team                                       |
   | `APPLE_PASSWORD`             | an app-specific password for that Apple ID (appleid.apple.com)        |
   | `APPLE_TEAM_ID`              | `L2SPUZJW2P`                                                          |

   With these set, tauri-bundler signs the app with the hardened runtime, submits the .dmg to
   `notarytool`, waits for approval, and staples the ticket. No entitlements file is needed:
   Chamber uses Keychain through the Security framework and shells out to `git`, both allowed
   under the hardened runtime by default.

### Windows (Authenticode via Azure Trusted Signing)

The `melodic-dev-signing` account and `melodic-cert-profile` certificate profile are shared across
Melodic apps (see `coax/docs/windows-signing-setup.md` for how they were created). Reuse them:

1. In Entra ID, either reuse the existing app registration that Tapedeck's release uses, or create
   a `Chamber` app registration and grant its service principal the
   **Artifact Signing Certificate Profile Signer** role on the `melodic-dev-signing` account.
2. Repository secrets:

   | Secret                     | Value                                       |
   | -------------------------- | ------------------------------------------- |
   | `AZURE_TENANT_ID`          | from the app registration                   |
   | `AZURE_CLIENT_ID`          | from the app registration                   |
   | `AZURE_CLIENT_SECRET`      | a client secret for it                      |
   | `TRUSTED_SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net`         |
   | `TRUSTED_SIGNING_ACCOUNT`  | `melodic-dev-signing`                       |
   | `TRUSTED_SIGNING_PROFILE`  | `melodic-cert-profile`                      |

   The workflow downloads `jsign` on the Windows runner; `bundle.windows.signCommand` in
   `src-tauri/tauri.conf.json` points Tauri at `scripts/sign-windows.mjs`, which exchanges the
   service-principal credentials for a bearer token and signs the .exe, the .msi, and the NSIS
   installer. The script refuses to run unsigned unless `SKIP_WIN_SIGN=1` is set, so a missing
   secret fails the build instead of shipping an unsigned binary.

### Updater signing key

`TAURI_SIGNING_PRIVATE_KEY` is the minisign private key whose public half is in
`src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Installed apps only accept updates
signed by it, so losing it means every user reinstalls by hand. It lives in `~/.tauri/` on the
build machine and is backed up in the secrets vault under `tokens/tauri/`.
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set but empty; the key has no password.

### Linux

Nothing to set up. The Ubuntu runner installs the WebKitGTK build dependencies and produces
AppImage, .deb, and .rpm. If distro signing ever matters, GPG-sign the .deb/.rpm in a later step.

## Per-release checklist

1. Bump the version in **three places** so they agree: `package.json`, `src-tauri/tauri.conf.json`,
   and `src-tauri/Cargo.toml`. Run `cd src-tauri && cargo check` so `Cargo.lock` updates.
2. Commit on `main`, then tag and push:

   ```sh
   git tag v0.1.0
   git push origin main --tags
   ```

3. Watch the **Release** workflow. Three jobs run in parallel; macOS takes the longest because
   of notarization (usually 5 to 15 minutes).
4. When all three finish, the `publish` job writes the notes and publishes. Check the release has
   the installers (`.dmg`, `-setup.exe`, `.msi`, `.AppImage`, `.deb`, `.rpm`), `latest.json`, and
   the `.sig` files. Edit the notes afterwards with `gh release edit vX.Y.Z --notes` if needed.
5. The marketing site's download button links to `releases/latest`, so it updates on its own.
   The repository must be **public** for that link (and the README/LICENSE links on the site) to work for visitors.

## Verifying a build

- **macOS:** `spctl -a -vv /Applications/Chamber.app` should print `source=Notarized Developer ID`.
  `stapler validate Chamber.app` confirms the ticket is stapled.
- **Windows:** right-click `Chamber.exe` → Properties → Digital Signatures should show
  Melodic Development, LLC. SmartScreen may show a one-time "new app" prompt until the
  certificate builds reputation; that fades after a few dozen downloads.
- **Linux:** `chmod +x` the AppImage and run it. `git` must be on the PATH.

## Local unsigned builds

```sh
SKIP_WIN_SIGN=1 npm run desktop:build
```

Produces installers under `src-tauri/target/release/bundle/` for the host platform only. On macOS
the app is ad-hoc signed and will need right-click → Open the first time.

## Website

The site deploys separately from the app. `web/` is built from its Dockerfile on Railway
(project `chamber`, service `chamber`, environment `production`).

- Public URL: https://chamber-production-a2cf.up.railway.app until DNS is in place, then
  https://chamber.melodic.dev.
- DNS: a `CNAME chamber` record pointing at the Railway target plus a `TXT _railway-verify.chamber`
  record. `railway domain status chamber.melodic.dev` from `web/` prints both values and reports
  when the certificate is issued.
- Automatic deploys: the Railway service is connected to the GitHub repo with Root Directory
  `web` and "Wait for CI" on, so pushes to `main` that touch `web/` rebuild `web/Dockerfile`
  once ci.yml passes. There is no GitHub Actions deploy step.
- Manual deploy: `cd web && railway up`.
