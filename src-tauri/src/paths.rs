//! A GUI app on macOS (and some Linux launchers) starts with a bare PATH, so
//! `git`, `ssh-add` and Git Credential Manager may not resolve. Prepend the
//! usual places before we spawn anything.

pub fn fix_path() {
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut parts: Vec<String> = vec![
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            "/usr/bin".into(),
            "/bin".into(),
            "/usr/sbin".into(),
            "/sbin".into(),
            format!("{home}/.local/bin"),
            format!("{home}/.cargo/bin"),
            "/usr/local/share/gcm-core".into(),
            "/Applications/Xcode.app/Contents/Developer/usr/bin".into(),
        ];
        // Ask the login shell what it thinks PATH is; best effort, short timeout by design of `-l -c`.
        if let Ok(shell) = std::env::var("SHELL") {
            if let Ok(out) = std::process::Command::new(&shell).args(["-l", "-c", "echo $PATH"]).output() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() {
                    parts.extend(s.split(':').map(String::from));
                }
            }
        }
        if let Ok(cur) = std::env::var("PATH") {
            parts.extend(cur.split(':').map(String::from));
        }
        let mut seen = std::collections::HashSet::new();
        let joined: Vec<String> = parts.into_iter().filter(|p| !p.is_empty() && seen.insert(p.clone())).collect();
        std::env::set_var("PATH", joined.join(":"));
    }
}
