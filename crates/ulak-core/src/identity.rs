use crate::model::*;
use anyhow::{Context, Result, bail, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey, Signature};
use rand::{RngCore, rngs::OsRng};
use rcgen::{BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose};
use std::net::IpAddr;

pub fn encode(bytes: &[u8]) -> String { B64.encode(bytes) }
pub fn decode(value: &str) -> Result<Vec<u8>> { Ok(B64.decode(value)?) }
pub fn secret() -> String { let mut bytes = [0; 32]; OsRng.fill_bytes(&mut bytes); encode(&bytes) }
pub fn token_hash(value: &str) -> String { blake3::hash(value.as_bytes()).to_hex().to_string() }
pub fn device_id(public_key: &str) -> Result<String> {
    let bytes = decode(public_key)?;
    ensure!(bytes.len() == 32, "Invalid public key length");
    Ok(blake3::hash(&bytes).to_hex().to_string())
}
pub fn signing_key(stored: &Stored) -> Result<SigningKey> {
    Ok(SigningKey::from_bytes(&decode(&stored.signing_seed)?.try_into().map_err(|_| anyhow::anyhow!("Invalid signing key"))?))
}
pub fn sign(stored: &Stored, message: &[u8]) -> Result<String> {
    Ok(encode(&signing_key(stored)?.sign(message).to_bytes()))
}
pub fn verify(identity: &DeviceIdentity, message: &[u8], signature: &str) -> Result<()> {
    ensure!(device_id(&identity.public_key)? == identity.id, "Identity mismatch");
    let public: [u8; 32] = decode(&identity.public_key)?.try_into().map_err(|_| anyhow::anyhow!("Invalid public key"))?;
    let signature = Signature::from_slice(&decode(signature)?)?;
    VerifyingKey::from_bytes(&public)?.verify(message, &signature).context("Invalid identity signature")
}
pub fn create(name: &str) -> Result<Stored> {
    ensure!(!name.is_empty() && name.len() <= 128, "Device name must contain 1–128 bytes");
    let key = SigningKey::generate(&mut OsRng);
    let public_key = encode(&key.verifying_key().to_bytes());
    let id = device_id(&public_key)?;
    let ca_key = KeyPair::generate()?;
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign, KeyUsagePurpose::DigitalSignature];
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, format!("Ulak {name} Local CA"));
    let ca = params.self_signed(&ca_key)?;
    Ok(Stored { schema: 1, signing_seed: encode(&key.to_bytes()), identity: DeviceIdentity { id, name: name.into(), public_key }, ca_key_pem: ca_key.serialize_pem(), ca_pem: ca.pem(), peers: Default::default(), shares: Default::default(), invitations: Default::default(), sessions: Default::default() })
}
pub fn server_certificate(stored: &Stored, addresses: &[IpAddr]) -> Result<(String, String)> {
    let ca_key = KeyPair::from_pem(&stored.ca_key_pem)?;
    let ca_params = CertificateParams::from_ca_cert_pem(&stored.ca_pem)?;
    let ca = ca_params.self_signed(&ca_key)?;
    let key = KeyPair::generate()?;
    let mut names: Vec<String> = addresses.iter().map(ToString::to_string).collect();
    names.push("localhost".into());
    let mut params = CertificateParams::new(names)?;
    params.distinguished_name.push(DnType::CommonName, &stored.identity.name);
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    let cert = params.signed_by(&key, &ca, &ca_key)?;
    Ok((format!("{}{}", cert.pem(), stored.ca_pem), key.serialize_pem()))
}
pub fn encode_descriptor<T: serde::Serialize>(value: &T) -> Result<String> {
    Ok(format!("ulak:{}", encode(&serde_json::to_vec(value)?)))
}
pub fn decode_descriptor<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    ensure!(value.len() <= 32 * 1024, "Descriptor too large");
    let Some(value) = value.strip_prefix("ulak:") else { bail!("Expected ulak: descriptor") };
    Ok(serde_json::from_slice(&decode(value)?)?)
}
pub fn validate_remote(remote: &Remote) -> Result<()> {
    ensure!(device_id(&remote.identity.public_key)? == remote.identity.id, "Invalid identity");
    ensure!(remote.identity.name.len() <= 128 && remote.ca_pem.len() <= 16_384, "Descriptor too large");
    let url = reqwest::Url::parse(&remote.endpoint)?;
    ensure!(url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && url.path() == "/" && url.query().is_none() && url.fragment().is_none(), "Expected HTTPS origin");
    // Native endpoints are explicit IP addresses, avoiding DNS changes and proxy routing.
    let host = url.host_str().context("Missing host")?.trim_matches(['[', ']']).parse::<IpAddr>()?;
    ensure!(!host.is_unspecified() && !host.is_multicast(), "Invalid peer address");
    reqwest::Certificate::from_pem(remote.ca_pem.as_bytes())?;
    Ok(())
}
