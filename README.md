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
