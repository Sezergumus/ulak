use std::{collections::BTreeSet, net::{IpAddr, Ipv4Addr}, path::Path};
use tempfile::TempDir;
use ulak_core::{Core, auth::{self, LanPolicy, Principal}, catalog, identity, model::*, server::byte_range};

fn setup(name: &str) -> (TempDir, Core) {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path().join("state"), name).unwrap();
    (directory, core)
}
fn pair(host: &Core, recipient: &Core) {
    let invitation = host.invite("https://127.0.0.1:7443/", None).unwrap();
    let mut request = PairRequest { token: invitation.token, remote: recipient.descriptor("https://127.0.0.1:7444/").unwrap(), signature: String::new() };
    request.signature = identity::sign(&recipient.read(), &auth::pair_message(&request).unwrap()).unwrap();
    auth::redeem_pair(host, request).unwrap();
}

#[test]
fn identity_and_offline_grants_survive_restart() {
    let (directory, host) = setup("Host");
    let (_recipient_dir, recipient) = setup("Recipient");
    pair(&host, &recipient);
    let identity = host.read().identity;
    let source = directory.path().join("example.txt");
    std::fs::write(&source, b"example").unwrap();
    let recipient_id = recipient.read().identity.id;
    let share = host.add_share(&source, Audience::Devices { devices: BTreeSet::from([recipient_id.clone()]) }).unwrap();
    assert_eq!(host.read().peers[&recipient_id].last_connected, None);
    drop(host);
    let host = Core::open(directory.path().join("state"), "Ignored new name").unwrap();
    assert_eq!(host.read().identity, identity);
    assert!(matches!(&host.read().shares[&share.id].audience, Audience::Devices { devices } if devices.contains(&recipient_id)));
}

#[test]
fn simultaneous_state_owners_are_rejected() {
    let (directory, _core) = setup("Host");
    assert!(Core::open(directory.path().join("state"), "Other").is_err());
}

#[test]
fn pairing_is_single_use_and_binds_the_full_descriptor() {
    let (_host_dir, host) = setup("Host");
    let (_recipient_dir, recipient) = setup("Recipient");
    let invitation = host.invite("https://127.0.0.1:7443/", None).unwrap();
    let mut request = PairRequest { token: invitation.token, remote: recipient.descriptor("https://127.0.0.1:7444/").unwrap(), signature: String::new() };
    request.signature = identity::sign(&recipient.read(), &auth::pair_message(&request).unwrap()).unwrap();
    let mut tampered = request.clone(); tampered.remote.endpoint = "https://127.0.0.1:9999/".into();
    assert!(auth::redeem_pair(&host, tampered).is_err());
    auth::redeem_pair(&host, request.clone()).unwrap();
    assert!(auth::redeem_pair(&host, request).is_err());
}

#[test]
fn signed_requests_reject_replays_spoofing_and_revoked_peers() {
    let (_host_dir, host) = setup("Host");
    let (_recipient_dir, recipient) = setup("Recipient");
    pair(&host, &recipient);
    let headers = auth::request_headers(&recipient, "GET", "/v1/shares").unwrap();
    assert!(auth::authenticate(&host, &headers, "GET", "/v1/shares?different=1").is_err());
    assert!(matches!(auth::authenticate(&host, &headers, "GET", "/v1/shares").unwrap(), Principal::Device(_)));
    assert!(auth::authenticate(&host, &headers, "GET", "/v1/shares").is_err());
    let headers = auth::request_headers(&recipient, "GET", "/v1/shares").unwrap();
    host.revoke_peer(&recipient.read().identity.id).unwrap();
    assert!(auth::authenticate(&host, &headers, "GET", "/v1/shares").is_err());
}

#[test]
fn lan_open_is_scoped_and_restricted_grants_are_identity_based() {
    let (directory, host) = setup("Host");
    let source = directory.path().join("file.txt"); std::fs::write(&source, b"public").unwrap();
    let public = host.add_share(&source, Audience::Lan).unwrap();
    let private = host.add_share(&source, Audience::Private).unwrap();
    let lan = LanPolicy { allowed: vec!["192.168.5.0/24".parse().unwrap()] };
    let local: IpAddr = "192.168.5.20".parse().unwrap();
    let external: IpAddr = "203.0.113.10".parse().unwrap();
    assert!(auth::authorized(&public, &Principal::Anonymous, local, &lan));
    assert!(!auth::authorized(&public, &Principal::Anonymous, external, &lan));
    assert!(!auth::authorized(&private, &Principal::Anonymous, local, &lan));
    assert!(host.accessible_share(&private.id, &Principal::Anonymous, local, &lan).is_err());
    host.set_audience(&public.id, Audience::Private).unwrap();
    assert!(host.accessible_share(&public.id, &Principal::Anonymous, local, &lan).is_err());
    assert!(host.set_audience(&private.id, Audience::Devices { devices: BTreeSet::from(["unknown".into()]) }).is_err());
}

#[test]
fn guest_sessions_are_scoped_expiring_revocable_and_single_use() {
    let (directory, host) = setup("Host");
    let source = directory.path().join("private.txt"); std::fs::write(&source, b"private").unwrap();
    let share = host.add_share(&source, Audience::Private).unwrap();
    let invite = host.invite("https://127.0.0.1:7443/", Some(BTreeSet::from([share.id.clone()]))).unwrap();
    let grant = auth::redeem_guest(&host, &invite.token).unwrap();
    assert!(auth::redeem_guest(&host, &invite.token).is_err());
    let mut headers = axum::http::HeaderMap::new(); headers.insert("authorization", format!("Bearer {}", grant.token).parse().unwrap());
    let principal = auth::authenticate(&host, &headers, "GET", "/v1/shares").unwrap();
    assert!(auth::authorized(&share, &principal, Ipv4Addr::LOCALHOST.into(), &LanPolicy::default()));
    host.update(|state| { state.sessions.get_mut(&identity::token_hash(&grant.token)).unwrap().last_used = now() - 1801; Ok(()) }).unwrap();
    assert!(auth::authenticate(&host, &headers, "GET", "/v1/shares").is_err());
    host.revoke_session(&grant.session_id).unwrap();
    assert!(host.read().sessions.is_empty());
}

#[test]
fn opaque_entries_reject_tampering_cross_share_tokens_and_traversal() {
    let (directory, core) = setup("Host");
    let source = directory.path().join("hello.txt"); std::fs::write(&source, b"hello").unwrap();
    let share = core.add_share(&source, Audience::Lan).unwrap();
    let token = core.entry_id(&share.id, Path::new("")).unwrap();
    assert!(core.entry_path(&share.id, &token).unwrap().as_os_str().is_empty());
    assert!(core.entry_path("other-share", &token).is_err());
    let mut bytes = identity::decode(&token).unwrap(); bytes[30] ^= 1;
    assert!(core.entry_path(&share.id, &identity::encode(&bytes)).is_err());
    for path in ["../secret", "C:\\secret", "CON", "aux.txt", "a:stream", "foo.", "foo ", "NUL", "COM1.log", "LPT9"] {
        assert!(catalog::safe_relative(Path::new(path)).is_err(), "accepted {path}");
    }
}

#[test]
fn paginated_directory_listing_has_a_fixed_page_bound() {
    let (directory, core) = setup("Host");
    let folder = directory.path().join("folder"); std::fs::create_dir(&folder).unwrap();
    for index in 0..235 { std::fs::write(folder.join(format!("{index}.txt")), b"data").unwrap(); }
    let share = core.add_share(&folder, Audience::Lan).unwrap();
    let mut cursor = None; let mut names = BTreeSet::new();
    loop {
        let page = core.list_entries(&share, None, cursor.as_deref(), &Principal::Anonymous).unwrap();
        assert!(page.items.len() <= 100);
        for item in page.items { assert!(names.insert(item.name)); }
        cursor = page.next_cursor;
        if cursor.is_none() { break; }
    }
    assert_eq!(names.len(), 235);
    assert!(core.0.directories.lock().unwrap().is_empty());
}

#[test]
fn missing_sources_are_unavailable_without_staging_copies() {
    let (directory, core) = setup("Host");
    let source = directory.path().join("source.txt"); std::fs::write(&source, b"data").unwrap();
    let share = core.add_share(&source, Audience::Lan).unwrap();
    std::fs::remove_file(source).unwrap();
    let page = core.list_shares(&Principal::Anonymous, Ipv4Addr::LOCALHOST.into(), &LanPolicy { allowed: vec!["127.0.0.1/32".parse().unwrap()] }, None);
    assert_eq!(page.items[0].id, share.id); assert!(!page.items[0].available);
}

#[test]
fn range_parser_covers_partial_suffix_empty_and_invalid_requests() {
    assert_eq!(byte_range(None, 10).unwrap(), (0, 10, false));
    assert_eq!(byte_range(Some("bytes=3-5"), 10).unwrap(), (3, 6, true));
    assert_eq!(byte_range(Some("bytes=8-"), 10).unwrap(), (8, 10, true));
    assert_eq!(byte_range(Some("bytes=-3"), 10).unwrap(), (7, 10, true));
    assert_eq!(byte_range(Some("bytes=0-99"), 10).unwrap(), (0, 10, true));
    assert_eq!(byte_range(None, 0).unwrap(), (0, 0, false));
    for range in ["bytes=10-", "bytes=5-4", "bytes=-0", "bytes=0-1,3-4", "items=0-1", "bytes=foo-"] { assert!(byte_range(Some(range), 10).is_err()); }
    assert!(byte_range(Some("bytes=0-"), 0).is_err());
}

#[cfg(windows)]
#[test]
fn active_source_handles_block_writes_and_deletion() {
    let (directory, core) = setup("Host");
    let source = directory.path().join("locked.txt"); std::fs::write(&source, b"data").unwrap();
    let share = core.add_share(&source, Audience::Lan).unwrap();
    let (file, guards) = catalog::open_source(&share, Path::new("")).unwrap();
    assert!(std::fs::OpenOptions::new().write(true).open(&source).is_err());
    assert!(std::fs::remove_file(&source).is_err());
    drop(file); drop(guards);
    assert!(std::fs::OpenOptions::new().write(true).open(&source).is_ok());
}
