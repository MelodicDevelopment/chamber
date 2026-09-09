//! Creating the remote repository, so "New chamber" can finish the job.
//!
//! This is the only place Chamber talks to a host's HTTP API — git cannot make
//! a repository that does not exist yet. The credential is the same one git
//! would use (`auth::api_token`), so connecting is the browser sign-in the user
//! would have done anyway, and nothing new is stored. GitHub only for now;
//! every other host falls back to pasting a URL, which always works.

use crate::auth::{self, Prompt, Provider};
use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};

const USER_AGENT: &str = concat!("Chamber/", env!("CARGO_PKG_VERSION"));
const ACCEPT: &str = "application/vnd.github+json";

/// Chamber's GitHub OAuth app. A client id is public by design for a native
/// app — there is no secret, which is the whole point of the device flow — so
/// it ships in the binary and needs no build configuration. A fork can point at
/// its own app with `CHAMBER_GITHUB_CLIENT_ID`; empty disables the browser
/// sign-in and the UI falls back to pasting a token.
pub fn client_id() -> &'static str {
    option_env!("CHAMBER_GITHUB_CLIENT_ID").unwrap_or("Ov23liZHFNdT8PInCc9l")
}

/// What we ask for: create repositories and push to them, and read the list of
/// organisations so the owner picker can offer them.
const SCOPES: &str = "repo read:org";

/// An account a repository can be created under: the signed-in user, or an
/// organisation they belong to.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Owner {
    pub login: String,
    /// "user" or "org" — organisations use a different create endpoint.
    pub kind: &'static str,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HostAccount {
    pub host: String,
    pub provider: Provider,
    pub provider_name: String,
    /// Whether Chamber can create repositories on this host at all.
    pub supported: bool,
    pub connected: bool,
    pub login: Option<String>,
    pub owners: Vec<Owner>,
    /// Why we are not connected, or why the credential we found is not enough.
    pub note: Option<String>,
    /// Where to make a token by hand when the sign-in cannot be used.
    pub token_page: Option<String>,
    /// Whether the browser sign-in is available (an OAuth app is configured).
    pub can_sign_in: bool,
    /// True when we hold a credential that the host rejected, so the UI can
    /// offer to clear it instead of looping on the same failure.
    pub stale_credential: bool,
}

/// A device-flow sign-in waiting for the user to approve it in a browser. Goes
/// out to the UI and comes back on the wait call, so it round-trips.
#[derive(Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    /// The short code the user types into GitHub.
    pub user_code: String,
    /// Where they type it.
    pub verification_uri: String,
    /// Opaque handle we poll with; never shown.
    pub device_code: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewRepo {
    pub full_name: String,
    pub ssh_url: String,
    pub https_url: String,
    pub html_url: String,
    /// Which of the two to use as the remote on this machine: SSH only when the
    /// agent actually holds a key, since a token sign-in cannot push over SSH.
    pub remote_url: String,
}

impl HostAccount {
    fn blank(host: &str) -> HostAccount {
        let info = auth::detect(&format!("https://{host}/"));
        HostAccount {
            supported: info.provider == Provider::GitHub,
            token_page: Some("https://github.com/settings/tokens/new?scopes=repo&description=Chamber".into()),
            host: host.to_string(),
            provider: info.provider,
            provider_name: info.provider_name,
            connected: false,
            login: None,
            owners: vec![],
            note: None,
            can_sign_in: !client_id().is_empty(),
            stale_credential: false,
        }
    }
}

/// api.github.com for github.com, `/api/v3` for GitHub Enterprise.
fn api_base(host: &str) -> String {
    if host == "github.com" || host == "www.github.com" {
        "https://api.github.com".to_string()
    } else {
        format!("https://{host}/api/v3")
    }
}

/// What every call gives back: the status, the response headers we care about,
/// and the body as JSON. Non-2xx is not an error here — the host's own message
/// ("name already exists on this account") is far more useful than a code.
type Reply = (u16, Vec<(String, String)>, serde_json::Value);

macro_rules! headers {
    ($req:expr, $token:expr) => {
        $req.config()
            .http_status_as_error(false)
            .build()
            .header("accept", ACCEPT)
            .header("user-agent", USER_AGENT)
            .header("x-github-api-version", "2022-11-28")
            .header("authorization", &format!("Bearer {}", $token))
    };
}

fn get(url: &str, token: &str) -> Result<Reply> {
    finish(headers!(ureq::get(url), token).call(), url)
}

fn post(url: &str, token: &str, body: serde_json::Value) -> Result<Reply> {
    finish(headers!(ureq::post(url), token).send_json(body), url)
}

fn finish(res: std::result::Result<ureq::http::Response<ureq::Body>, ureq::Error>, url: &str) -> Result<Reply> {
    let mut res = res.map_err(|e| AppError::msg(format!("could not reach {url}: {e}")))?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_ascii_lowercase(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let text = res.body_mut().read_to_string().unwrap_or_default();
    let json = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    Ok((status, headers, json))
}

/// The `message` GitHub returns on an error, with the first field error appended.
fn api_message(json: &serde_json::Value, status: u16) -> String {
    let base = json.get("message").and_then(|m| m.as_str()).unwrap_or("the host refused that").to_string();
    let detail = json
        .get("errors")
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
        .and_then(|e| e.get("message").and_then(|m| m.as_str()).map(str::to_string));
    match detail {
        Some(d) if !d.is_empty() && d != base => format!("{base} — {d}"),
        _ if status == 403 => format!("{base} (the sign-in may not allow creating repositories)"),
        _ => base,
    }
}

/// Who are we on this host, and where could a repository go? Never fails for
/// "not signed in" — that is an answer, and the UI shows a Connect button.
pub fn account(host: &str, prompt: Prompt) -> Result<HostAccount> {
    let mut acct = HostAccount::blank(host);
    if !acct.supported {
        acct.note = Some(format!("Chamber can only create repositories on GitHub so far. Make one on {} and paste its URL.", acct.provider_name));
        return Ok(acct);
    }
    let Some((_, token)) = auth::api_token(host, prompt)? else {
        return Ok(acct);
    };
    let base = api_base(host);
    let (status, headers, me) = get(&format!("{base}/user"), &token)?;
    if status != 200 {
        // We had a credential and the host would not take it: saying so, and
        // letting the user clear it, beats offering the same sign-in again.
        acct.stale_credential = status == 401 || status == 403;
        acct.note = Some(api_message(&me, status));
        return Ok(acct);
    }
    let login = me.get("login").and_then(|l| l.as_str()).unwrap_or_default().to_string();
    acct.connected = true;
    acct.owners.push(Owner { login: login.clone(), kind: "user" });
    acct.login = Some(login);

    // Classic tokens advertise their scopes; a fine-grained one sends nothing,
    // and we only find out whether it can create when we try.
    if let Some(scopes) = headers.iter().find(|(k, _)| k == "x-oauth-scopes").map(|(_, v)| v.as_str()) {
        if !scopes.split(',').any(|s| s.trim() == "repo" || s.trim() == "public_repo") {
            acct.note = Some("This sign-in cannot create repositories. Disconnect and paste a token with the `repo` scope, or use a repository URL.".into());
        }
    }

    // Organisations are best-effort: a token without `read:org` still creates
    // personal repositories fine, so a failure here is not worth reporting.
    if let Ok((200, _, orgs)) = get(&format!("{base}/user/orgs?per_page=100"), &token) {
        for o in orgs.as_array().unwrap_or(&vec![]) {
            if let Some(l) = o.get("login").and_then(|l| l.as_str()) {
                acct.owners.push(Owner { login: l.to_string(), kind: "org" });
            }
        }
    }
    Ok(acct)
}

/// Create an empty repository and hand back its URLs. `owner` is one of the
/// logins from `account`; the user's own login means a personal repository.
pub fn create_repo(host: &str, owner: &str, name: &str, private: bool) -> Result<NewRepo> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::msg("give the repository a name"));
    }
    let acct = account(host, Prompt::Interactive)?;
    if !acct.supported {
        return Err(AppError::msg(acct.note.unwrap_or_else(|| "Chamber cannot create repositories on this host".into())));
    }
    let Some((_, token)) = auth::api_token(host, Prompt::Interactive)? else {
        return Err(AppError::msg(format!("not signed in to {host}")));
    };
    let base = api_base(host);
    let is_org = acct.owners.iter().any(|o| o.login == owner && o.kind == "org");
    let url = if is_org { format!("{base}/orgs/{owner}/repos") } else { format!("{base}/user/repos") };
    let body = json!({
        "name": name,
        "private": private,
        "description": "Secrets, sealed with Chamber",
        "auto_init": false,
    });
    let (status, _, res) = post(&url, &token, body)?;
    if status != 201 {
        return Err(AppError::msg(api_message(&res, status)));
    }
    let field = |k: &str| res.get(k).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let full_name = field("full_name");
    let ssh = {
        let s = field("ssh_url");
        if s.is_empty() { format!("git@{host}:{full_name}.git") } else { s }
    };
    let https = {
        let s = field("clone_url");
        if s.is_empty() { format!("https://{host}/{full_name}.git") } else { s }
    };
    Ok(NewRepo {
        remote_url: if auth::ssh_key_available() { ssh.clone() } else { https.clone() },
        ssh_url: ssh,
        https_url: https,
        html_url: {
            let s = field("html_url");
            if s.is_empty() { format!("https://{host}/{full_name}") } else { s }
        },
        full_name,
    })
}

// ---- the browser sign-in (OAuth device flow) --------------------------------
//
// The same flow `gh auth login` uses. GitHub does not support PKCE, so the
// authorization-code flow would need a client secret we cannot keep in a
// desktop binary; the device flow needs none. GitHub only — Bitbucket and
// Azure DevOps have no equivalent, and those hosts use a pasted token or a
// repository URL instead.

/// Form-encoded POST to github.com (not the API host), unauthenticated.
fn post_form(url: &str, fields: &[(&str, &str)]) -> Result<serde_json::Value> {
    let mut res = ureq::post(url)
        .config()
        .http_status_as_error(false)
        .build()
        .header("accept", "application/json")
        .header("user-agent", USER_AGENT)
        .send_form(fields.to_vec())
        .map_err(|e| AppError::msg(format!("could not reach {url}: {e}")))?;
    let text = res.body_mut().read_to_string().unwrap_or_default();
    serde_json::from_str(&text).map_err(|_| AppError::msg(format!("unexpected reply from {url}")))
}

/// Ask GitHub for a code the user can approve in a browser.
pub fn device_start() -> Result<DeviceCode> {
    let id = client_id();
    if id.is_empty() {
        return Err(AppError::msg("this build has no GitHub sign-in configured; paste a token instead"));
    }
    let v = post_form("https://github.com/login/device/code", &[("client_id", id), ("scope", SCOPES)])?;
    if let Some(err) = v.get("error_description").and_then(|e| e.as_str()) {
        return Err(AppError::msg(err.to_string()));
    }
    let field = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let code = field("device_code");
    if code.is_empty() {
        return Err(AppError::msg("GitHub did not start the sign-in"));
    }
    Ok(DeviceCode {
        user_code: field("user_code"),
        verification_uri: {
            let u = field("verification_uri");
            if u.is_empty() { "https://github.com/login/device".into() } else { u }
        },
        device_code: code,
        interval: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5).max(1),
        expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900),
    })
}

/// Poll until the user approves, refuses, or the code expires. Blocking, so the
/// caller runs it off the main thread; `cancel` lets the UI abandon it without
/// leaving a thread polling for the full fifteen minutes.
pub fn device_wait(code: &DeviceCode, cancel: &AtomicBool) -> Result<String> {
    let id = client_id();
    let mut interval = code.interval;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(code.expires_in);
    loop {
        std::thread::sleep(std::time::Duration::from_secs(interval));
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::msg("sign-in cancelled"));
        }
        if std::time::Instant::now() > deadline {
            return Err(AppError::msg("the sign-in code expired — try again"));
        }
        let v = post_form(
            "https://github.com/login/oauth/access_token",
            &[("client_id", id), ("device_code", &code.device_code), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")],
        )?;
        if let Some(token) = v.get("access_token").and_then(|t| t.as_str()) {
            if !token.is_empty() {
                return Ok(token.to_string());
            }
        }
        match v.get("error").and_then(|e| e.as_str()).unwrap_or("") {
            "authorization_pending" => continue,
            "slow_down" => interval += 5, // GitHub asks us to back off; obey or it keeps refusing
            "expired_token" => return Err(AppError::msg("the sign-in code expired — try again")),
            "access_denied" => return Err(AppError::msg("the sign-in was refused on GitHub")),
            other => {
                let msg = v.get("error_description").and_then(|d| d.as_str()).unwrap_or(other);
                return Err(AppError::msg(if msg.is_empty() { "GitHub refused the sign-in".to_string() } else { msg.to_string() }));
            }
        }
    }
}

/// Check a token works and remember it, so git can use it for pushes too.
/// Returns the account it belongs to.
pub fn adopt_token(host: &str, token: &str) -> Result<HostAccount> {
    let base = api_base(host);
    let (status, _, me) = get(&format!("{base}/user"), token)?;
    if status != 200 {
        return Err(AppError::msg(api_message(&me, status)));
    }
    let login = me.get("login").and_then(|l| l.as_str()).unwrap_or("x-access-token");
    auth::store_token(host, login, token)?;
    account(host, Prompt::Silent)
}
