//! Thin wrapper over the system `git`. Shelling out means the user's SSH agent,
//! credential helpers and Git Credential Manager all work without us knowing.

use crate::error::{AppError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone)]
pub struct Git {
    pub dir: PathBuf,
    /// Extra environment for auth (GIT_ASKPASS + secrets), set per host by `auth`.
    env: Vec<(String, String)>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub hash: String,
    pub date: String,
    pub author: String,
    pub subject: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub branch: String,
    pub remote: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub merge_in_progress: bool,
    pub conflicts: Vec<String>,
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Keep {
    Mine,
    Theirs,
}

impl Git {
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Git { dir: dir.into(), env: vec![] }
    }

    pub fn with_env(mut self, env: Vec<(String, String)>) -> Self {
        self.env = env;
        self
    }

    fn command(&self) -> Command {
        let mut c = Command::new("git");
        c.env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C");
        for (k, v) in &self.env {
            c.env(k, v);
        }
        c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        c
    }

    /// Run in the repo directory.
    pub fn run(&self, args: &[&str]) -> Result<String> {
        let mut c = self.command();
        c.current_dir(&self.dir).args(args);
        exec(c)
    }

    /// Run without a working directory (clone, ls-remote).
    pub fn run_global(env: &[(String, String)], args: &[&str]) -> Result<String> {
        let g = Git::at(std::env::temp_dir()).with_env(env.to_vec());
        let mut c = g.command();
        c.args(args);
        exec(c)
    }

    pub fn version() -> Result<String> {
        Git::run_global(&[], &["--version"])
    }

    pub fn is_repo(dir: &Path) -> bool {
        dir.join(".git").exists()
    }

    pub fn init(dir: &Path) -> Result<Git> {
        std::fs::create_dir_all(dir)?;
        let g = Git::at(dir);
        g.run(&["init", "-q", "-b", "main"])?;
        Ok(g)
    }

    pub fn clone(url: &str, dest: &Path, env: &[(String, String)]) -> Result<Git> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Git::run_global(env, &["clone", "-q", url, &dest.to_string_lossy()])?;
        Ok(Git::at(dest).with_env(env.to_vec()))
    }

    pub fn ls_remote(url: &str, env: &[(String, String)]) -> Result<()> {
        Git::run_global(env, &["ls-remote", "--exit-code", "-h", url]).map(|_| ())
    }

    pub fn ensure_author(&self, name: &str, email: &str) -> Result<()> {
        if self.run(&["config", "--get", "user.name"]).map(|s| s.trim().is_empty()).unwrap_or(true) {
            self.run(&["config", "user.name", name])?;
        }
        if self.run(&["config", "--get", "user.email"]).map(|s| s.trim().is_empty()).unwrap_or(true) {
            self.run(&["config", "user.email", email])?;
        }
        Ok(())
    }

    pub fn author_name(&self) -> String {
        self.run(&["config", "--get", "user.name"]).map(|s| s.trim().to_string()).unwrap_or_default()
    }

    pub fn branch(&self) -> Result<String> {
        Ok(self.run(&["symbolic-ref", "--short", "HEAD"])?.trim().to_string())
    }

    pub fn remote_url(&self) -> Option<String> {
        self.run(&["remote", "get-url", "origin"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    pub fn set_remote(&self, url: &str) -> Result<()> {
        if self.remote_url().is_some() {
            self.run(&["remote", "set-url", "origin", url])?;
        } else {
            self.run(&["remote", "add", "origin", url])?;
        }
        Ok(())
    }

    pub fn has_commits(&self) -> bool {
        self.run(&["rev-parse", "--verify", "HEAD"]).is_ok()
    }

    /// Stage the given paths and commit if anything changed. Returns the new hash.
    pub fn commit_paths(&self, paths: &[&str], message: &str) -> Result<Option<String>> {
        let mut args = vec!["add", "-A", "--"];
        args.extend(paths.iter().copied());
        self.run(&args)?;
        if self.run(&["diff", "--cached", "--quiet"]).is_ok() {
            return Ok(None); // nothing staged
        }
        self.run(&["commit", "-q", "-m", message])?;
        Ok(Some(self.run(&["rev-parse", "HEAD"])?.trim().to_string()))
    }

    pub fn dirty(&self) -> bool {
        self.run(&["status", "--porcelain"]).map(|s| !s.trim().is_empty()).unwrap_or(false)
    }

    pub fn fetch(&self) -> Result<()> {
        if self.remote_url().is_none() {
            return Ok(());
        }
        self.run(&["fetch", "-q", "origin"]).map(|_| ())
    }

    pub fn merge_in_progress(&self) -> bool {
        self.dir.join(".git/MERGE_HEAD").exists()
    }

    pub fn conflicted_paths(&self) -> Vec<String> {
        self.run(&["diff", "--name-only", "--diff-filter=U"])
            .map(|s| s.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
            .unwrap_or_default()
    }

    pub fn status(&self) -> Result<SyncStatus> {
        let branch = self.branch().unwrap_or_else(|_| "main".into());
        let remote = self.remote_url();
        let (mut ahead, mut behind) = (0, 0);
        if remote.is_some() && self.has_commits() {
            let upstream = format!("origin/{branch}");
            if self.run(&["rev-parse", "--verify", "-q", &upstream]).is_ok() {
                let out = self.run(&["rev-list", "--left-right", "--count", &format!("HEAD...{upstream}")])?;
                let mut it = out.split_whitespace();
                ahead = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                behind = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            } else {
                ahead = self.run(&["rev-list", "--count", "HEAD"]).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
            }
        }
        Ok(SyncStatus {
            branch,
            remote,
            ahead,
            behind,
            dirty: self.dirty(),
            merge_in_progress: self.merge_in_progress(),
            conflicts: self.conflicted_paths(),
        })
    }

    /// Merge origin/<branch>. On conflict the merge is left in progress and the
    /// conflicted paths are returned as `AppError::Conflict`.
    pub fn merge_remote(&self) -> Result<()> {
        let branch = self.branch()?;
        let upstream = format!("origin/{branch}");
        if self.run(&["rev-parse", "--verify", "-q", &upstream]).is_err() {
            return Ok(()); // remote is empty
        }
        if !self.has_commits() {
            // Fresh clone target with nothing local: fast-forward by resetting.
            self.run(&["reset", "-q", "--hard", &upstream])?;
            return Ok(());
        }
        match self.run(&["merge", "-q", "--no-edit", &upstream]) {
            Ok(_) => Ok(()),
            Err(AppError::Git(msg)) => {
                let conflicts = self.conflicted_paths();
                if conflicts.is_empty() {
                    Err(AppError::Git(msg))
                } else {
                    Err(AppError::Conflict(conflicts))
                }
            }
            Err(e) => Err(e),
        }
    }

    pub fn resolve(&self, path: &str, keep: Keep) -> Result<()> {
        let side = match keep {
            Keep::Mine => "--ours",
            Keep::Theirs => "--theirs",
        };
        self.run(&["checkout", side, "--", path])?;
        self.run(&["add", "--", path])?;
        Ok(())
    }

    pub fn finish_merge(&self) -> Result<()> {
        if !self.conflicted_paths().is_empty() {
            return Err(AppError::Conflict(self.conflicted_paths()));
        }
        if self.merge_in_progress() {
            self.run(&["commit", "-q", "--no-edit"])?;
        }
        Ok(())
    }

    /// Not wired to the UI yet; the conflict dialog resolves per file instead. Kept for a future "discard merge" action.
    #[allow(dead_code)]
    pub fn abort_merge(&self) -> Result<()> {
        if self.merge_in_progress() {
            self.run(&["merge", "--abort"])?;
        }
        Ok(())
    }

    pub fn push(&self) -> Result<()> {
        if self.remote_url().is_none() {
            return Ok(());
        }
        let branch = self.branch()?;
        self.run(&["push", "-q", "-u", "origin", &branch]).map(|_| ())
    }

    pub fn log(&self, path: Option<&str>, limit: usize) -> Result<Vec<LogEntry>> {
        if !self.has_commits() {
            return Ok(vec![]);
        }
        let n = limit.to_string();
        let mut args = vec!["log", "--format=%H%x1f%aI%x1f%an%x1f%s", "-n", &n];
        if let Some(p) = path {
            args.push("--");
            args.push(p);
        }
        let out = self.run(&args)?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let mut f = l.split('\x1f');
                Some(LogEntry {
                    hash: f.next()?.to_string(),
                    date: f.next()?.to_string(),
                    author: f.next()?.to_string(),
                    subject: f.next().unwrap_or("").to_string(),
                })
            })
            .collect())
    }

    pub fn show_bytes(&self, rev: &str, path: &str) -> Result<Vec<u8>> {
        let mut c = self.command();
        c.current_dir(&self.dir).args(["show", &format!("{rev}:{path}")]);
        let out = c.output()?;
        if !out.status.success() {
            return Err(AppError::Git(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(out.stdout)
    }
}

fn exec(mut c: Command) -> Result<String> {
    let out = c.output().map_err(|e| AppError::Git(format!("could not run git: {e}")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        Err(AppError::Git(msg))
    }
}
