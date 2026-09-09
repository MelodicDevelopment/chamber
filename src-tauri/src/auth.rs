//! The auth ladder: SSH agent → existing git credentials → Git Credential
//! Manager (browser sign-in) → a pasted token kept in the OS keystore.
//! Git does the talking, using whichever rung applies; `hosting` borrows the
//! same credential for the one thing git cannot do, creating a repository.

use crate::error::{AppError, Result};
use crate::git::Git;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const TOKEN_SERVICE: &str = "dev.melodic.chamber.token";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    GitHub,
    GitLab,
    Bitbucket,
    AzureDevOps,
    Other,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub url: String,
    pub host: String,
    pub provider: Provider,
    pub provider_name: String,
    pub is_ssh: bool,
    /// Equivalent SSH URL when we can derive one from an HTTPS URL.
    pub ssh_url: Option<String>,
    /// Equivalent HTTPS URL when given SSH.
    pub https_url: Option<String>,
    pub token_page: Option<String>,
    pub token_scope: String,
    pub token_username: String,
    // availability of each rung on this machine
    pub ssh_key_available: bool,
    pub credential_cached: bool,
    pub gcm_available: bool,
    pub token_stored: bool,
    /// How to get Git Credential Manager on this OS, for when `gcm_available` is false.
    pub gcm_install: GcmInstall,
}

/// Platform-specific way to install Git Credential Manager.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GcmInstall {
    pub platform: &'static str,
    /// One shell command that installs it, when there is a good one.
    pub command: Option<&'static str>,
    pub url: &'static str,
    pub note: &'static str,
}

pub fn gcm_install() -> GcmInstall {
    #[cfg(target_os = "macos")]
    {
        GcmInstall {
            platform: "macos",
            command: Some("brew install --cask git-credential-manager"),
            url: "https://github.com/git-ecosystem/git-credential-manager/blob/release/docs/install.md#macos",
            note: "Needs Homebrew. There is also a .pkg installer on the releases page.",
        }
    }
    #[cfg(windows)]
    {
        GcmInstall {
            platform: "windows",
            command: Some("winget install --id Git.Git -e --source winget"),
            url: "https://github.com/git-ecosystem/git-credential-manager/blob/release/docs/install.md#windows",
            note: "Git for Windows bundles it. If Git is already installed, re-run its installer and keep Git Credential Manager selected.",
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        GcmInstall {
            platform: "linux",
            command: None,
            url: "https://github.com/git-ecosystem/git-credential-manager/blob/release/docs/install.md#linux",
            note: "Install the .deb or tarball from the releases page, then run git-credential-manager configure.",
        }
    }
}

/// Whether git should be allowed to open a browser or prompt during this call.
/// Background work (status polls) must never prompt; user-initiated syncs may.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prompt {
    Interactive,
    Silent,
}

pub fn detect(url: &str) -> HostInfo {
    let url = url.trim().to_string();
    let (is_ssh, host, path) = parse(&url);
    let provider = match host.as_str() {
        h if h == "github.com" || h.ends_with(".github.com") => Provider::GitHub,
        h if h == "gitlab.com" || h.contains("gitlab") => Provider::GitLab,
        h if h == "bitbucket.org" || h.contains("bitbucket") => Provider::Bitbucket,
        h if h == "dev.azure.com" || h.ends_with("visualstudio.com") || h == "ssh.dev.azure.com" => Provider::AzureDevOps,
        _ => Provider::Other,
    };
    let provider_name = match provider {
        Provider::GitHub => "GitHub",
        Provider::GitLab => "GitLab",
        Provider::Bitbucket => "Bitbucket",
        Provider::AzureDevOps => "Azure DevOps",
        Provider::Other => "Git host",
    }
    .to_string();
    let (token_page, token_scope, token_username) = match provider {
        Provider::GitHub => (Some("https://github.com/settings/personal-access-tokens/new".into()), "Contents: read and write".into(), "x-access-token".into()),
        Provider::GitLab => (Some(format!("https://{host}/-/user_settings/personal_access_tokens")), "write_repository".into(), "oauth2".into()),
        Provider::Bitbucket => (Some("https://bitbucket.org/account/settings/app-passwords/".into()), "Repositories: read and write".into(), "x-token-auth".into()),
        Provider::AzureDevOps => (Some("https://dev.azure.com/_usersSettings/tokens".into()), "Code: read and write".into(), "chamber".into()),
        Provider::Other => (None, "read and write access to the repository".into(), "git".into()),
    };
    let (ssh_url, https_url) = match (&provider, is_ssh) {
        (Provider::GitHub | Provider::GitLab | Provider::Bitbucket, false) => (Some(format!("git@{host}:{path}")), None),
        (Provider::GitHub | Provider::GitLab | Provider::Bitbucket, true) => (None, Some(format!("https://{host}/{path}"))),
        (Provider::AzureDevOps, false) => {
            // https://dev.azure.com/org/project/_git/repo -> git@ssh.dev.azure.com:v3/org/project/repo
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() >= 4 && parts[2] == "_git" {
                (Some(format!("git@ssh.dev.azure.com:v3/{}/{}/{}", parts[0], parts[1], parts[3])), None)
            } else {
                (None, None)
            }
        }
        _ => (None, None),
    };
    HostInfo {
        ssh_key_available: ssh_key_available(),
        credential_cached: !is_ssh && credential_cached(&host),
        gcm_available: gcm_available(),
        token_stored: token(&host).map(|t| t.is_some()).unwrap_or(false),
        gcm_install: gcm_install(),
        url,
        host,
        provider,
        provider_name,
        is_ssh,
        ssh_url,
        https_url,
        token_page,
        token_scope,
        token_username,
    }
}

/// (is_ssh, host, path-without-.git)
fn parse(url: &str) -> (bool, String, String) {
    let strip = |p: &str| p.trim_matches('/').trim_end_matches(".git").to_string();
    if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
        let host = host.split(':').next().unwrap_or(host);
        return (true, host.to_string(), strip(path));
    }
    if let Some((user_host, path)) = url.split_once(':') {
        if !user_host.contains("//") && user_host.contains('@') {
            let host = user_host.split('@').nth(1).unwrap_or("");
            return (true, host.to_string(), strip(path));
        }
    }
    if let Ok(u) = url::Url::parse(url) {
        return (false, u.host_str().unwrap_or("").to_string(), strip(u.path()));
    }
    (false, String::new(), String::new())
}

pub fn ssh_key_available() -> bool {
    Command::new("ssh-add").arg("-l").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).output().map(|o| o.status.success()).unwrap_or(false)
}

pub fn gcm_available() -> bool {
    gcm_helper().is_some()
}

/// The `credential.helper` name that reaches Git Credential Manager on this machine.
/// GCM 2.x installs `git-credential-manager` (helper name `manager`); older builds
/// installed `git-credential-manager-core` (`manager-core`).
pub fn gcm_helper() -> Option<&'static str> {
    let runs = |cmd: &str, args: &[&str]| Command::new(cmd).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
    if runs("git-credential-manager", &["--version"]) || runs("git", &["credential-manager", "--version"]) {
        return Some("manager");
    }
    if runs("git-credential-manager-core", &["--version"]) {
        return Some("manager-core");
    }
    None
}

/// True when the user's own git config already routes credentials through GCM.
fn gcm_configured() -> bool {
    Command::new("git")
        .args(["config", "--get-all", "credential.helper"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().any(|l| l.trim().contains("manager")))
        .unwrap_or(false)
}

/// Environment that lets Git Credential Manager run for one call, without
/// touching the user's own config. Shared by `env_for` and `credential_fill`.
fn gcm_env(prompt: Prompt) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![];
    if prompt == Prompt::Silent {
        env.push(("GCM_INTERACTIVE".into(), "never".into()));
    }
    if let Some(helper) = gcm_helper() {
        if !gcm_configured() {
            env.push(("GIT_CONFIG_COUNT".into(), "1".into()));
            env.push(("GIT_CONFIG_KEY_0".into(), "credential.helper".into()));
            env.push(("GIT_CONFIG_VALUE_0".into(), helper.into()));
        }
        // GCM on Linux refuses to run until a credential store is chosen; default to the desktop keyring.
        #[cfg(all(unix, not(target_os = "macos")))]
        if std::env::var_os("GCM_CREDENTIAL_STORE").is_none() {
            let configured = Command::new("git").args(["config", "--get", "credential.credentialStore"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).output().map(|o| !o.stdout.is_empty()).unwrap_or(false);
            if !configured {
                env.push(("GCM_CREDENTIAL_STORE".into(), "secretservice".into()));
            }
        }
    }
    env
}

/// Ask git's own helpers for the credential they hold for `host`. `Silent`
/// forbids any prompting, so it answers "is one already cached?"; `Interactive`
/// lets Git Credential Manager open the browser sign-in to get one.
pub fn credential_fill(host: &str, prompt: Prompt) -> Option<(String, String)> {
    use std::io::Write;
    let mut c = Command::new("git");
    c.args(["credential", "fill"]).env("GIT_TERMINAL_PROMPT", "0");
    if prompt == Prompt::Silent {
        c.env("GIT_ASKPASS", "true"); // never fall back to asking us for it
    }
    for (k, v) in gcm_env(prompt) {
        c.env(k, v);
    }
    let Ok(mut child) = c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
        return None;
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = write!(stdin, "protocol=https\nhost={host}\n\n");
    }
    // A helper that decides to wait on something (a browser tab nobody will
    // open, a locked keyring) must not hang the caller forever.
    let deadline = std::time::Instant::now() + if prompt == Prompt::Silent { std::time::Duration::from_secs(10) } else { std::time::Duration::from_secs(180) };
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                return None;
            }
            Err(_) => return None,
        }
    }
    let out = child.wait_with_output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let field = |k: &str| text.lines().find_map(|l| l.strip_prefix(k).map(str::to_string));
    let secret = field("password=")?;
    Some((field("username=").unwrap_or_else(|| "x-access-token".into()), secret))
}

/// Ask git's configured helpers for a credential without letting them prompt.
pub fn credential_cached(host: &str) -> bool {
    credential_fill(host, Prompt::Silent).is_some()
}

/// A credential Chamber can use against a host's HTTP API. Same ladder git
/// climbs: a token the user gave us, else whatever Git Credential Manager
/// already holds (or, when `Interactive`, will fetch by browser sign-in).
pub fn api_token(host: &str, prompt: Prompt) -> Result<Option<(String, String)>> {
    if let Some(pair) = token(host)? {
        return Ok(Some(pair));
    }
    Ok(credential_fill(host, prompt))
}

/// Drop everything we hold for `host`: our own token and the helpers' copy.
pub fn credential_forget(host: &str) -> Result<()> {
    use std::io::Write;
    forget_token(host)?;
    let mut c = Command::new("git");
    c.args(["credential", "reject"]).env("GIT_TERMINAL_PROMPT", "0");
    for (k, v) in gcm_env(Prompt::Silent) {
        c.env(k, v);
    }
    if let Ok(mut child) = c.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = write!(stdin, "protocol=https\nhost={host}\n\n");
        }
        let _ = child.wait();
    }
    Ok(())
}

// ---- tokens in the OS keystore -------------------------------------------

fn token_entry(host: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(TOKEN_SERVICE, host)?)
}

pub fn token(host: &str) -> Result<Option<(String, String)>> {
    match token_entry(host)?.get_password() {
        Ok(v) => Ok(v.split_once('\n').map(|(u, p)| (u.to_string(), p.to_string()))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn store_token(host: &str, username: &str, token: &str) -> Result<()> {
    token_entry(host)?.set_password(&format!("{username}\n{token}"))?;
    Ok(())
}

pub fn forget_token(host: &str) -> Result<()> {
    match token_entry(host)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Environment for one git call against `host`.
///
/// With a stored token: GIT_ASKPASS feeds it and every other helper is disabled.
/// Without one: git's own helpers run (SSH agent, osxkeychain, ...). If Git
/// Credential Manager is installed but not wired into the user's config, it is
/// added as a helper for this call so the browser sign-in rung works. `Silent`
/// forbids GCM from prompting at all, so background fetches never open a browser.
pub fn env_for(host: &str, askpass_dir: &Path, prompt: Prompt) -> Result<Vec<(String, String)>> {
    if let Some((user, secret)) = token(host)? {
        let script = askpass_script(askpass_dir)?;
        return Ok(vec![
            ("GIT_ASKPASS".into(), script.to_string_lossy().to_string()),
            ("CHAMBER_GIT_USER".into(), user),
            ("CHAMBER_GIT_SECRET".into(), secret),
            ("GIT_CONFIG_COUNT".into(), "1".into()),
            ("GIT_CONFIG_KEY_0".into(), "credential.helper".into()),
            ("GIT_CONFIG_VALUE_0".into(), "".into()), // don't let other helpers cache or override the token
        ]);
    }
    Ok(gcm_env(prompt))
}

fn askpass_script(dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    #[cfg(windows)]
    {
        let p = dir.join("askpass.bat");
        std::fs::write(&p, "@echo off\r\necho %1 | findstr /i Username >nul && (echo %CHAMBER_GIT_USER%) || (echo %CHAMBER_GIT_SECRET%)\r\n")?;
        Ok(p)
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("askpass.sh");
        std::fs::write(&p, "#!/bin/sh\ncase \"$1\" in\n  *sername*) printf '%s\\n' \"$CHAMBER_GIT_USER\" ;;\n  *) printf '%s\\n' \"$CHAMBER_GIT_SECRET\" ;;\nesac\n")?;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o700))?;
        Ok(p)
    }
}

/// Can we reach the repo with what we have? Classifies the failure for the UI.
pub fn check(url: &str, askpass_dir: &Path, prompt: Prompt) -> Result<()> {
    let info = detect(url);
    let env = if info.is_ssh { vec![] } else { env_for(&info.host, askpass_dir, prompt)? };
    Git::ls_remote(url, &env).map_err(|e| match e {
        AppError::Git(m) => AppError::Git(m),
        other => other,
    })
}
