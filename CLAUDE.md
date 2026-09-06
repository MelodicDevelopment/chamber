# Chamber

Cross-platform desktop app (Tauri 2 + Melodic JS/Components 3.1) for storing secrets encrypted with age inside a git repository. Free and simple by design: drop a file, it is sealed and committed; one Sync button pushes and pulls; any git host works.

Started 2026-09-04 as a product version of Rick's personal `~/.secrets` vault (age + git + Keychain). "Start small" is the mandate; multi-vault ("chambers") and multi-keeper sharing are in the data model from day one.

## Vocabulary

- **Chamber** — one git repo + a keepers list. The app manages several; the sidebar switcher picks one.
- **Keeper** — a person/device with an age public key in `.chamber/recipients`. Only keepers can open the chamber.
- **Folder** — a directory inside the vault (`foundry/railway.env` is in folder `foundry`). Derived from paths. Sidebar order and folders with no secrets yet live in the app config per chamber (`ChamberRef.folders`, saved via `chamber_set_folders`), never in the repo. Code still says `room`/`roomOf` in places; UI text says folder.
- **Seal** — encrypt + commit. **Sync** — fetch, merge, push.

## Layout

```
src-tauri/src/
  identity.rs   age x25519 identity in the OS keystore (keyring crate); recovery kit = scrypt-encrypted armored export
  chamber.rs    repo layout, encrypt/decrypt, recipients, index, rekey
  git.rs        thin wrapper over system git (never libgit2): commit, fetch, merge, push, log, conflicts
  auth.rs       auth ladder + host detection + token storage (GIT_ASKPASS env for stored tokens)
  config.rs     app-level registry of chambers (~/Library/Application Support/dev.melodic.chamber/chambers.json)
  commands.rs   Tauri commands (thin; camelCase DTOs). Heavy git/crypto commands are `async`.
  paths.rs      PATH fix for GUI-launched apps so git/ssh-add/GCM resolve
src/
  main.ts, components.ts (barrel), routes.ts
  services/backend.service.ts   the ONLY place that calls invoke(); has an in-memory demo for browser preview
  pages/welcome  first launch: key created, recovery kit, first chamber
  pages/vault    main window: sidebar, list, masked viewer, drag-drop, sync, keepers, history, settings dialogs
  pages/join     paste URL → auth ladder → clone
  shared/        env parsing/masking, formatting, keyhole mark, theme.ts (appearance), pairing.ts (QR payload), qr-code + qr-scanner components
  styles/global.css   Chamber theme: light tokens on :root, dark on :root[data-theme='dark'] (linked with `melodic-styles`)
vite-plugin-melodic-styles.ts   copied from kingdom; required so --ml-* tokens reach shadow roots
web/                  static marketing site (chamber.melodic.dev), same shape as tapedeck/web; deployed by FTP on push
scripts/sign-windows.mjs   Windows Authenticode via Azure Trusted Signing, called by bundle.windows.signCommand
.github/workflows     ci.yml (typecheck, vite build, clippy -D warnings, cargo test), release.yml (tag → signed draft release), deploy-website.yml
docs/release.md       signing/notarization setup + per-release checklist
```

Chamber repo layout (what gets committed): `vault/**.age`, `.chamber/recipients` (one `age1… label` per line), `.chamber/index.json` (ciphertext sha256/size/sealed_at/sealed_by — never plaintext hashes), `.gitignore`, `README.md`. Clones live under the app data dir, never in user folders.

## Security decisions (do not regress)

- Private key never touches disk unencrypted; stored via `keyring` (Keychain / Credential Manager / Secret Service).
- Change detection compares decrypted content, not mtimes. Index stores hashes of ciphertext only.
- Only `vault/` and `.chamber/` are ever staged (`Git::commit_paths`), never `git add -A` of a working tree.
- Removing a keeper rekeys everything and returns the list of secrets they could read, for rotation prompts.
- Reveal is per-value for 30 s; copied secrets are cleared from the clipboard after 30 s.
- Auth ladder: SSH agent → git's own credential helpers → Git Credential Manager (browser sign-in; covers GitHub, Bitbucket Cloud, Azure DevOps, GitLab) → pasted token. Tokens go in the keystore and are fed to git via a GIT_ASKPASS script with `credential.helper=` cleared for that call. Never write tokens to disk or argv.
- GCM: `auth::gcm_helper()` finds `manager`/`manager-core`; if the user's git config does not already route through GCM, `env_for` adds it as a helper for that call only. Every git call takes an `auth::Prompt`: `Silent` sets `GCM_INTERACTIVE=never` and is the default for `open_chamber` (status polls, local ops); only `sync_now`, `sync_resolve`, `chamber_create`/`chamber_join` and `auth_check` are `Interactive`. A background fetch must never open a browser. On Linux `GCM_CREDENTIAL_STORE=secretservice` is set when nothing is configured. Missing GCM shows platform install guidance (`HostInfo.gcmInstall`) with a Check again button on the Join page.
- QR pairing carries only `<age public key> <label>` (one recipients line). Never encode the private key; the recovery kit is the only export path. The scanner (`chamber-qr-scanner`) uses the platform BarcodeDetector when present, jsQR otherwise; the camera stops when the Scan dialog closes. macOS needs `NSCameraUsageDescription` (src-tauri/Info.plist).
- CSP is `default-src 'self'`; fonts are bundled via @fontsource, not Google Fonts.

## Conventions

- Melodic 3-file component pattern for big pages (component/template/styles), single-file for small ones. `@Service()` for DI, `@ml:click`/`@ml:input` for Melodic events, `@click` for native. Components self-register on import; add new ones to `src/components.ts`.
- Never import `@tauri-apps/*` at module top level in files the browser preview loads; `backend.service.ts` lazy-imports inside `isDesktop()`.
- Theme: no hard-coded colors in component styles. Use `--ml-*` or the Chamber tokens in global.css (`--ch-brass`, `--ch-hover`, `--ch-popover`, `--ch-code-bg`, `--ch-hero`, `--ch-card-glass`, ...); every `--ch-*` has a light and a dark value. Appearance (system/light/dark) is in Settings; stored in localStorage as `chamber.theme`, default dark. `setTheme()` also sets the native window theme.
- Rust errors are `AppError` → serialized as `{kind, message, paths}`; `kind` ∈ conflict | auth | git | locked | keychain | error. The UI branches on `kind`.
- Dialog-opening Tauri commands must be `async` (blocking dialogs on the main thread wedge the app).
- Commits: author as Rick only. No AI attribution trailers.

## Design

Two canvases (Claude Design artifacts). Chamber is the chosen direction:
- Chamber: https://claude.ai/code/artifact/b1e1d113-1e49-4b4c-8239-1456cceb47c5 — obsidian + warm stone, flat brass `#D9A652` as the single accent (buttons, selection rails, inscriptions), verdigris `#4FB58A` for clean/revealed, ember `#E8785F` for conflicts/attention. IBM Plex Sans everywhere (no serif), IBM Plex Mono for keys/values. Keyhole mark + "CHAMBER" in spaced caps. Secret viewer styled like a code window (amber keys, green revealed values, dim masks).
- Melodic Vault (earlier, melodic.dev-branded alternative, kept for reference): https://claude.ai/code/artifact/4cfbd8e4-64d8-4d35-98f7-0d61ba2b168a

## Run

```sh
npm install
npm run desktop:dev     # Tauri window + Vite on :5180
npm run dev             # browser preview with demo backend
npm run typecheck && (cd src-tauri && cargo check)
npm run icon            # regenerate icons from icon-source.svg (keep the ~10% macOS inset)
```

## Status / next

Done: scaffold compiles and launches; welcome → create chamber → drop files → masked viewer → sync/conflict UI → keepers/history/settings dialogs → join flow with auth ladder.
Folders: `+` opens New folder with the selected folder preselected as the location; right-click / ⋯ on a sidebar folder → New folder inside, Rename (leaf only), Move to…, Delete (keep secrets and move them up, or delete all). Drag rows or folders onto folders (pointer events, since Tauri's dragDropEnabled breaks HTML5 DnD); dragging a folder onto the top/bottom quarter of another folder row reorders it (and re-parents if the rows are not siblings). The New folder dialog has a location picker; clicking the open folder again returns to All secrets. Backend: `secrets_move` renames ciphertext only (no re-encrypt); `secrets_remove` deletes many in one commit. Dialogs are `<ml-dialog #name>` opened via DialogService, never `el.open()`.
GCM guidance, light theme and QR pairing landed 2026-09-06 (branch feat/gcm-light-qr): Join page installs/rechecks GCM; Settings has Appearance; the locked panel, Join page and Settings show this device's QR; Keepers → Scan from another device reads it with the webcam and fills the add-keeper fields. Verified in the browser preview (screenshots, QR encode→decode roundtrip); the webcam scan and the GCM browser sign-in are not yet exercised on the desktop build.
The sidebar | list | detail dividers drag to resize (`.resizer` handles, pointer events on window, min/max clamps, double-click resets); widths are `--sidebar-w`/`--list-w` on the page host, saved in localStorage.
Not yet verified end to end on a real remote. Release pipeline exists but has not run yet (needs the Apple + Azure secrets copied in, see docs/release.md). Open items: Windows/Linux smoke test, encrypted filenames (optional), real-device test of QR scan + GCM sign-in.
