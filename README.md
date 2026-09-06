# Chamber

Encrypted secrets, synced through git. Drop a file, it is sealed with [age](https://age-encryption.org) to every keeper's public key and committed. One Sync button pushes and pulls. Works with any git host over SSH, Git Credential Manager, or a pasted token.

## Develop

```sh
npm install
npm run desktop:dev      # Tauri window + Vite dev server
npm run dev              # browser preview with an in-memory demo backend
npm run desktop:build    # installers under src-tauri/target/release/bundle
```

Requires Rust (stable), Node 22+, and `git` on the PATH at runtime. Git Credential Manager is optional and detected when present.

## Layout

- `src-tauri/` — Rust: age encryption (`chamber.rs`), keystore-backed identity (`identity.rs`), git wrapper (`git.rs`), auth ladder (`auth.rs`), Tauri commands (`commands.rs`).
- `src/` — Melodic JS app: welcome, vault, and join pages; `services/backend.service.ts` is the only place that talks to Tauri.
- A chamber repo holds `vault/**.age`, `.chamber/recipients`, and `.chamber/index.json`. Nothing in it is readable without a keeper's private key.

## Website

`web/` is the static marketing site at chamber.melodic.dev, served by nginx from `web/Dockerfile` on Railway (project `chamber`, service `chamber`). Pushes to `main` that touch `web/` deploy it through `.github/workflows/deploy-website.yml` (needs the `RAILWAY_TOKEN` secret); `railway up` from `web/` deploys by hand. `web/screenshot.png` is the hero image; retake it from the browser demo when the UI changes. To view it locally: `docker compose -f web/docker-compose.yml up -d` and open http://localhost:8931.

## Release

Push a `vX.Y.Z` tag and `.github/workflows/release.yml` builds signed, notarized installers for macOS, Windows, and Linux into a draft GitHub release. Setup and the per-release checklist are in [docs/release.md](docs/release.md).

## License

MIT. See [LICENSE](LICENSE).
