//! The auth ladder: SSH agent → existing git credentials → Git Credential
//! Manager (browser sign-in) → a pasted token kept in the OS keystore.
//! We never talk to a host's API; git does, using whichever rung applies.

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
    for cmd in ["git-credential-manager", "git-credential-manager-core"] {
        if Command::new(cmd).arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false) {
            return true;
        }
    }
    Command::new("git").args(["credential-manager", "--version"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

/// Ask git's configured helpers for a credential without letting them prompt.
pub fn credential_cached(host: &str) -> bool {
    use std::io::Write;
    let Ok(mut child) = Command::new("git")
        .args(["credential", "fill"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_ASKPASS", "true")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = write!(stdin, "protocol=https\nhost={host}\n\n");
    }
    child.wait_with_output().map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains("password=")).unwrap_or(false)
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

/// Environment that makes git use a stored token for `host` via GIT_ASKPASS.
/// Returns an empty list when there is no token, so git falls back to its own
/// helpers (SSH agent, osxkeychain, GCM, ...).
pub fn env_for(host: &str, askpass_dir: &Path) -> Result<Vec<(String, String)>> {
    let Some((user, secret)) = token(host)? else { return Ok(vec![]) };
    let script = askpass_script(askpass_dir)?;
    Ok(vec![
        ("GIT_ASKPASS".into(), script.to_string_lossy().to_string()),
        ("CHAMBER_GIT_USER".into(), user),
        ("CHAMBER_GIT_SECRET".into(), secret),
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("GIT_CONFIG_KEY_0".into(), "credential.helper".into()),
        ("GIT_CONFIG_VALUE_0".into(), "".into()), // don't let other helpers cache or override the token
    ])
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
pub fn check(url: &str, askpass_dir: &Path) -> Result<()> {
    let info = detect(url);
    let env = if info.is_ssh { vec![] } else { env_for(&info.host, askpass_dir)? };
    Git::ls_remote(url, &env).map_err(|e| match e {
        AppError::Git(m) => AppError::Git(m),
        other => other,
    })
}
