//! A chamber is one git repository holding `vault/**.age`, a recipients list,
//! and a small index of non-sensitive metadata.

use crate::error::{AppError, Result};
use crate::git::Git;
use age::x25519;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const VAULT_DIR: &str = "vault";
pub const META_DIR: &str = ".chamber";
pub const RECIPIENTS_FILE: &str = ".chamber/recipients";
pub const INDEX_FILE: &str = ".chamber/index.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    /// Size of the ciphertext on disk. Plaintext size is not recorded.
    pub size: u64,
    pub sealed_at: String,
    pub sealed_by: String,
    /// SHA-256 of the ciphertext, used for change detection across devices.
    pub sha256: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub version: u32,
    pub entries: BTreeMap<String, Entry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recipient {
    pub public_key: String,
    pub label: String,
}

pub struct Chamber {
    pub root: PathBuf,
    pub git: Git,
}

impl Chamber {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        if !root.join(META_DIR).is_dir() {
            return Err(AppError::msg("this repository is not a chamber (no .chamber directory)"));
        }
        let git = Git::at(&root);
        Ok(Chamber { root, git })
    }

    pub fn is_chamber(root: &Path) -> bool {
        root.join(RECIPIENTS_FILE).is_file()
    }

    /// Create a fresh chamber at `root` with `public_key` as the first keeper.
    pub fn create(root: &Path, name: &str, public_key: &str, label: &str, author: (&str, &str)) -> Result<Self> {
        let git = if Git::is_repo(root) { Git::at(root) } else { Git::init(root)? };
        git.ensure_author(author.0, author.1)?;
        std::fs::create_dir_all(root.join(VAULT_DIR))?;
        std::fs::create_dir_all(root.join(META_DIR))?;
        std::fs::write(root.join(VAULT_DIR).join(".gitkeep"), b"")?;
        std::fs::write(root.join(RECIPIENTS_FILE), format!("{public_key} {label}\n"))?;
        let index = Index { version: 1, entries: BTreeMap::new() };
        std::fs::write(root.join(INDEX_FILE), serde_json::to_string_pretty(&index)?)?;
        std::fs::write(
            root.join(".gitignore"),
            "# Chamber: only encrypted files and chamber metadata are tracked.\n*\n!.gitignore\n!README.md\n!.chamber/\n!.chamber/**\n!vault/\n!vault/**\n.DS_Store\n",
        )?;
        std::fs::write(
            root.join("README.md"),
            format!("# {name}\n\nThis repository is a [Chamber](https://melodic.dev). Every file under `vault/` is encrypted with [age](https://age-encryption.org) to the public keys listed in `.chamber/recipients`. Nothing here is readable without one of those private keys.\n"),
        )?;
        git.commit_paths(&[".gitignore", "README.md", META_DIR, VAULT_DIR], "Create chamber")?;
        Ok(Chamber { root: root.to_path_buf(), git })
    }

    // ---- recipients -------------------------------------------------------

    pub fn recipients(&self) -> Result<Vec<Recipient>> {
        let text = std::fs::read_to_string(self.root.join(RECIPIENTS_FILE)).unwrap_or_default();
        Ok(text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|l| {
                let (pk, label) = l.split_once(char::is_whitespace).unwrap_or((l, ""));
                Recipient { public_key: pk.to_string(), label: label.trim().to_string() }
            })
            .collect())
    }

    fn write_recipients(&self, list: &[Recipient]) -> Result<()> {
        let mut s = String::from("# One age public key per line, followed by a label. Managed by Chamber.\n");
        for r in list {
            s.push_str(&format!("{} {}\n", r.public_key, r.label));
        }
        std::fs::write(self.root.join(RECIPIENTS_FILE), s)?;
        Ok(())
    }

    pub fn has_access(&self, public_key: &str) -> Result<bool> {
        Ok(self.recipients()?.iter().any(|r| r.public_key == public_key))
    }

    pub fn add_recipient(&self, identity: &x25519::Identity, public_key: &str, label: &str) -> Result<()> {
        public_key.parse::<x25519::Recipient>().map_err(|e| AppError::msg(format!("not an age public key: {e}")))?;
        let mut list = self.recipients()?;
        if list.iter().any(|r| r.public_key == public_key) {
            return Ok(());
        }
        list.push(Recipient { public_key: public_key.to_string(), label: label.to_string() });
        self.write_recipients(&list)?;
        self.rekey(identity)?;
        self.git.commit_paths(&[META_DIR, VAULT_DIR], &format!("Add keeper {label}"))?;
        Ok(())
    }

    /// Remove a keeper and re-encrypt everything. Returns the paths that were
    /// readable by the removed key, which the caller should tell the user to rotate.
    pub fn remove_recipient(&self, identity: &x25519::Identity, public_key: &str) -> Result<Vec<String>> {
        let mut list = self.recipients()?;
        let before = list.len();
        list.retain(|r| r.public_key != public_key);
        if list.len() == before {
            return Ok(vec![]);
        }
        if list.is_empty() {
            return Err(AppError::msg("a chamber must keep at least one keeper"));
        }
        self.write_recipients(&list)?;
        let exposed: Vec<String> = self.index()?.entries.keys().cloned().collect();
        self.rekey(identity)?;
        self.git.commit_paths(&[META_DIR, VAULT_DIR], "Remove keeper and rekey")?;
        Ok(exposed)
    }

    /// Decrypt every secret and re-encrypt it to the current recipients.
    pub fn rekey(&self, identity: &x25519::Identity) -> Result<()> {
        let recipients = self.parsed_recipients()?;
        let mut index = self.index()?;
        let author = self.git.author_name();
        for (path, entry) in index.entries.iter_mut() {
            let plain = self.decrypt_path(identity, path)?;
            let cipher = encrypt(&plain, &recipients)?;
            self.write_cipher(path, &cipher)?;
            entry.size = cipher.len() as u64;
            entry.sha256 = sha256_hex(&cipher);
            entry.sealed_at = now();
            entry.sealed_by = author.clone();
        }
        self.write_index(&index)
    }

    fn parsed_recipients(&self) -> Result<Vec<x25519::Recipient>> {
        let list = self.recipients()?;
        if list.is_empty() {
            return Err(AppError::msg("this chamber has no keepers"));
        }
        list.iter()
            .map(|r| r.public_key.parse::<x25519::Recipient>().map_err(|e| AppError::msg(format!("bad recipient {}: {e}", r.public_key))))
            .collect()
    }

    // ---- index ------------------------------------------------------------

    pub fn index(&self) -> Result<Index> {
        let p = self.root.join(INDEX_FILE);
        if !p.exists() {
            return Ok(Index { version: 1, entries: BTreeMap::new() });
        }
        Ok(serde_json::from_str(&std::fs::read_to_string(p)?)?)
    }

    fn write_index(&self, index: &Index) -> Result<()> {
        std::fs::write(self.root.join(INDEX_FILE), serde_json::to_string_pretty(index)?)?;
        Ok(())
    }

    /// Rebuild the index from what's on disk (after a merge, or an older client).
    pub fn reconcile_index(&self) -> Result<Index> {
        let mut index = self.index()?;
        let vault = self.root.join(VAULT_DIR);
        let mut seen = std::collections::BTreeSet::new();
        for e in walkdir::WalkDir::new(&vault).into_iter().filter_map(|e| e.ok()) {
            if !e.file_type().is_file() {
                continue;
            }
            let rel = e.path().strip_prefix(&vault).unwrap().to_string_lossy().replace('\\', "/");
            let Some(path) = rel.strip_suffix(".age") else { continue };
            seen.insert(path.to_string());
            let bytes = std::fs::read(e.path())?;
            let sha = sha256_hex(&bytes);
            let entry = index.entries.entry(path.to_string()).or_insert_with(|| Entry {
                path: path.to_string(),
                size: 0,
                sealed_at: now(),
                sealed_by: String::new(),
                sha256: String::new(),
            });
            if entry.sha256 != sha {
                entry.sha256 = sha;
                entry.size = bytes.len() as u64;
            }
        }
        index.entries.retain(|k, _| seen.contains(k));
        self.write_index(&index)?;
        Ok(index)
    }

    pub fn list(&self) -> Result<Vec<Entry>> {
        Ok(self.reconcile_index()?.entries.into_values().collect())
    }

    // ---- secrets ----------------------------------------------------------

    fn cipher_path(&self, rel: &str) -> PathBuf {
        self.root.join(VAULT_DIR).join(format!("{rel}.age"))
    }

    fn write_cipher(&self, rel: &str, cipher: &[u8]) -> Result<()> {
        let p = self.cipher_path(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(p, cipher)?;
        Ok(())
    }

    pub fn decrypt_path(&self, identity: &x25519::Identity, rel: &str) -> Result<Vec<u8>> {
        let cipher = std::fs::read(self.cipher_path(rel))?;
        decrypt(&cipher, identity)
    }

    /// Encrypt `plain` as `rel`. Returns false when the stored secret already
    /// has this exact content (so nothing is written or committed).
    pub fn seal(&self, identity: &x25519::Identity, rel: &str, plain: &[u8]) -> Result<bool> {
        let rel = normalize_rel(rel)?;
        if self.cipher_path(&rel).exists() {
            if let Ok(existing) = self.decrypt_path(identity, &rel) {
                if existing == plain {
                    return Ok(false);
                }
            }
        }
        let recipients = self.parsed_recipients()?;
        let cipher = encrypt(plain, &recipients)?;
        self.write_cipher(&rel, &cipher)?;
        let mut index = self.index()?;
        index.entries.insert(
            rel.clone(),
            Entry { path: rel.clone(), size: cipher.len() as u64, sealed_at: now(), sealed_by: self.git.author_name(), sha256: sha256_hex(&cipher) },
        );
        self.write_index(&index)?;
        self.git.commit_paths(&[META_DIR, VAULT_DIR], &format!("Seal {rel}"))?;
        Ok(true)
    }

    pub fn remove(&self, rel: &str) -> Result<()> {
        let rel = normalize_rel(rel)?;
        let p = self.cipher_path(&rel);
        if p.exists() {
            std::fs::remove_file(&p)?;
        }
        let mut index = self.index()?;
        index.entries.remove(&rel);
        self.write_index(&index)?;
        self.git.commit_paths(&[META_DIR, VAULT_DIR], &format!("Remove {rel}"))?;
        Ok(())
    }

    /// A previous version, straight out of git history.
    pub fn decrypt_at(&self, identity: &x25519::Identity, rev: &str, rel: &str) -> Result<Vec<u8>> {
        let cipher = self.git.show_bytes(rev, &format!("{VAULT_DIR}/{rel}.age"))?;
        decrypt(&cipher, identity)
    }
}

pub fn encrypt(plain: &[u8], recipients: &[x25519::Recipient]) -> Result<Vec<u8>> {
    let encryptor = age::Encryptor::with_recipients(recipients.iter().map(|r| r as &dyn age::Recipient))?;
    let mut out = Vec::with_capacity(plain.len() + 256);
    let mut w = encryptor.wrap_output(&mut out)?;
    w.write_all(plain)?;
    w.finish()?;
    Ok(out)
}

pub fn decrypt(cipher: &[u8], identity: &x25519::Identity) -> Result<Vec<u8>> {
    let decryptor = age::Decryptor::new(cipher)?;
    let mut r = decryptor.decrypt(std::iter::once(identity as &dyn age::Identity))?;
    let mut out = Vec::new();
    r.read_to_end(&mut out)?;
    Ok(out)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Keep paths inside the vault: forward slashes, no `..`, no leading slash.
pub fn normalize_rel(rel: &str) -> Result<String> {
    let s = rel.trim().replace('\\', "/");
    let s = s.trim_start_matches('/').to_string();
    if s.is_empty() || s.split('/').any(|seg| seg == ".." || seg.is_empty() || seg == ".") {
        return Err(AppError::msg(format!("invalid secret path: {rel}")));
    }
    Ok(s)
}
