# Releasing Chamber

Signed, notarized installers for macOS, Windows, and Linux come out of one GitHub Actions run
(`.github/workflows/release.yml`), triggered by pushing a `vX.Y.Z` tag. It is the same pipeline
Tapedeck uses: `tauri-action` on native runners, Apple notarization handled by the Tauri bundler,
Windows Authenticode through Azure Trusted Signing via `scripts/sign-windows.mjs`. Linux is not
signed; AppImage, .deb, and .rpm are uploaded as-is.

## One-time setup

All of the credentials below already exist for Tapedeck and Coax. Nothing new needs to be bought
or validated; the work is copying secrets into this repository.

### macOS (sign + notarize)

1. In the Apple Developer account, make sure a **Developer ID Application** certificate exists.
   Export it with its private key from Keychain Access as a `.p12`.
2. Repository secrets:

   | Secret                       | Value                                                                 |
   | ---------------------------- | --------------------------------------------------------------------- |
   | `APPLE_CERTIFICATE`          | `base64 -i DeveloperID.p12 \| pbcopy`                                 |
   | `APPLE_CERTIFICATE_PASSWORD` | the .p12 export password                                              |
   | `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: Melodic Development, LLC (TEAMID)`        |
   | `APPLE_ID`                   | the Apple ID that owns the team                                       |
   | `APPLE_PASSWORD`             | an app-specific password for that Apple ID (appleid.apple.com)        |
   | `APPLE_TEAM_ID`              | the 10-character team ID                                              |

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
4. When all three finish, open the **draft release** on GitHub, check the assets are there
   (`Chamber_x.y.z_universal.dmg`, `Chamber_x.y.z_x64-setup.exe`, `Chamber_x.y.z_x64_en-US.msi`,
   `Chamber_x.y.z_amd64.AppImage`, `.deb`, `.rpm`), write the notes, and publish.
5. The marketing site's download button links to `releases/latest`, so it updates on its own.

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
