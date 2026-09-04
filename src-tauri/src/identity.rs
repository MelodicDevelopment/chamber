//! The user's age identity. Lives in the OS keystore, never on disk in the clear.

use crate::error::{AppError, Result};
use age::secrecy::{ExposeSecret, SecretString};
use age::x25519;
use std::io::{Read, Write};
use std::str::FromStr;

const SERVICE: &str = "dev.melodic.chamber";
const USER: &str = "identity";

fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, USER)?)
}

/// Load the identity, creating one on first use.
pub fn load_or_create() -> Result<x25519::Identity> {
    match entry()?.get_password() {
        Ok(secret) => x25519::Identity::from_str(secret.trim()).map_err(|e| AppError::msg(format!("stored identity is invalid: {e}"))),
        Err(keyring::Error::NoEntry) => {
            let id = x25519::Identity::generate();
            entry()?.set_password(id.to_string().expose_secret())?;
            Ok(id)
        }
        Err(e) => Err(e.into()),
    }
}

pub fn exists() -> Result<bool> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

pub fn public_key() -> Result<String> {
    Ok(load_or_create()?.to_public().to_string())
}

/// Recovery kit: the identity, passphrase-encrypted with age's scrypt recipient,
/// ASCII-armored so it can be printed or pasted into a password manager.
pub fn export_recovery_kit(passphrase: &str) -> Result<String> {
    if passphrase.chars().count() < 8 {
        return Err(AppError::msg("passphrase must be at least 8 characters"));
    }
    let id = load_or_create()?;
    let body = format!(
        "# Chamber recovery kit\n# created: {}\n# public key: {}\n{}\n",
        chrono::Utc::now().to_rfc3339(),
        id.to_public(),
        id.to_string().expose_secret()
    );
    let recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_owned()));
    let mut out = Vec::new();
    {
        let armored = age::armor::ArmoredWriter::wrap_output(&mut out, age::armor::Format::AsciiArmor)?;
        let encryptor = age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))?;
        let mut w = encryptor.wrap_output(armored)?;
        w.write_all(body.as_bytes())?;
        w.finish()?.finish()?;
    }
    Ok(String::from_utf8(out).expect("armor is ascii"))
}

/// Restore an identity from a recovery kit. Replaces whatever is in the keystore.
pub fn import_recovery_kit(kit: &str, passphrase: &str) -> Result<String> {
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
    let armored = age::armor::ArmoredReader::new(kit.as_bytes());
    let decryptor = age::Decryptor::new(armored)?;
    let mut reader = decryptor.decrypt(std::iter::once(&identity as &dyn age::Identity))?;
    let mut body = String::new();
    reader.read_to_string(&mut body)?;
    let secret = body
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("AGE-SECRET-KEY-"))
        .ok_or_else(|| AppError::msg("recovery kit does not contain an identity"))?;
    let id = x25519::Identity::from_str(secret).map_err(|e| AppError::msg(format!("recovery kit identity is invalid: {e}")))?;
    entry()?.set_password(secret)?;
    Ok(id.to_public().to_string())
}
