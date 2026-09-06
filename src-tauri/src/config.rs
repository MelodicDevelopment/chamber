//! App-level registry of chambers. Lives in the OS config dir, never in a repo.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChamberRef {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub remote: Option<String>,
    pub created_at: String,
    /// Sidebar folder order chosen by the user. Also keeps folders that hold no secrets yet
    /// (git cannot store an empty directory). Paths are relative to `vault/`, like `team/staging`.
    #[serde(default)]
    pub folders: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub chambers: Vec<ChamberRef>,
    pub current: Option<String>,
    pub recovery_saved: bool,
    pub device_name: Option<String>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
}

impl AppConfig {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&ChamberRef> {
        self.chambers.iter().find(|c| c.id == id)
    }

    pub fn device_name(&self) -> String {
        self.device_name.clone().unwrap_or_else(|| {
            std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .ok()
                .or_else(|| {
                    std::process::Command::new("hostname").arg("-s").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string())
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "this device".into())
        })
    }

    pub fn author(&self) -> (String, String) {
        let name = self.author_name.clone().unwrap_or_else(whoami);
        let email = self.author_email.clone().unwrap_or_else(|| format!("{}@{}", slug(&name), slug(&self.device_name())));
        (name, email)
    }
}

fn whoami() -> String {
    std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "chamber".into())
}

fn slug(s: &str) -> String {
    let s: String = s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    s.trim_matches('-').to_string()
}
