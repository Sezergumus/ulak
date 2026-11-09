use super::*;
use std::{ffi::c_void, mem::size_of, time::Duration};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        },
        GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

fn user_sid() -> Result<String> {
    unsafe {
        let mut token = std::ptr::null_mut();
        ensure!(
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0,
            "Cannot open current-user token"
        );
        struct Token(*mut c_void);
        impl Drop for Token {
            fn drop(&mut self) {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        let _token = Token(token);
        let mut length = 0;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut length);
        ensure!(length > 0, "Cannot measure current-user SID");
        let mut bytes = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
        ensure!(
            GetTokenInformation(
                token,
                TokenUser,
                bytes.as_mut_ptr().cast(),
                length,
                &mut length
            ) != 0,
            "Cannot read current-user SID"
        );
        let user = &*bytes.as_ptr().cast::<TOKEN_USER>();
        let mut text = std::ptr::null_mut();
        ensure!(
            ConvertSidToStringSidW(user.User.Sid, &mut text) != 0,
            "Cannot encode current-user SID"
        );
        let mut count = 0;
        while *text.add(count) != 0 {
            count += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, count));
        LocalFree(text.cast());
        Ok(sid)
    }
}

fn create(name: &str, sid: &str, first: bool) -> Result<NamedPipeServer> {
    let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe {
        let mut descriptor = std::ptr::null_mut();
        ensure!(
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut()
            ) != 0,
            "Cannot create pipe security descriptor"
        );
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let pipe = ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .in_buffer_size(65536)
            .out_buffer_size(65536)
            .max_instances(10)
            .create_with_security_attributes_raw(
                name,
                (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
            );
        LocalFree(descriptor);
        Ok(pipe?)
    }
}

/// Bind before announcing readiness. No TCP listener is used for local management.
pub fn serve(core: Core, stop: CancellationToken) -> Result<tokio::task::JoinHandle<Result<()>>> {
    let sid = user_sid()?;
    let name = pipe_key(&core.0.directory, &sid)?;
    let mut listener = create(&name, &sid, true)?;
    Ok(tokio::spawn(async move {
        let slots = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                _ = stop.cancelled() => break,
                Some(_) = tasks.join_next(), if !tasks.is_empty() => continue,
                result = listener.connect() => result?,
            }
            let connected = listener;
            listener = create(&name, &sid, false)?;
            let Ok(permit) = slots.clone().try_acquire_owned() else {
                drop(connected);
                continue;
            };
            let core = core.clone();
            let stop = stop.child_token();
            tasks.spawn(async move {
                let _permit = permit;
                let mut pipe = connected;
                let operation = async {
                    let bytes = tokio::time::timeout(
                        Duration::from_secs(10),
                        read_frame(&mut pipe, MAX_REQUEST),
                    )
                    .await??;
                    let request = serde_json::from_slice(&bytes)?;
                    dispatch(&core, request, stop.clone()).await
                };
                let result =
                    tokio::select! { _ = stop.cancelled() => return, result = operation => result };
                let response = match result {
                    Ok(value) => Response {
                        result: Some(value),
                        error: None,
                    },
                    Err(error) => Response {
                        result: None,
                        error: Some(format!("{error:#}")),
                    },
                };
                if let Ok(bytes) = serde_json::to_vec(&response) {
                    let _ = tokio::time::timeout(
                        Duration::from_secs(10),
                        write_frame(&mut pipe, &bytes, MAX_RESPONSE),
                    )
                    .await;
                    // Disconnecting before the client consumes buffered output loses data.
                    let mut acknowledgement = [0];
                    let _ = tokio::time::timeout(
                        Duration::from_secs(5),
                        pipe.read_exact(&mut acknowledgement),
                    )
                    .await;
                }
            });
        }
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
        Ok(())
    }))
}

pub async fn connect(directory: &Path, request: Request) -> Result<serde_json::Value> {
    let name = pipe_key(directory, &user_sid()?)?;
    let mut client = None;
    for _ in 0..30 {
        match ClientOptions::new().open(&name) {
            Ok(pipe) => {
                client = Some(pipe);
                break;
            }
            Err(error) if error.raw_os_error() == Some(231) => {
                tokio::time::sleep(Duration::from_millis(100)).await
            }
            Err(error) => return Err(error).context(
                "Cannot connect to the running Ulak desktop; start it with the same data directory",
            ),
        }
    }
    let mut pipe = client.context("Local management pipe is busy")?;
    write_frame(&mut pipe, &serde_json::to_vec(&request)?, MAX_REQUEST).await?;
    let response: Response = serde_json::from_slice(&read_frame(&mut pipe, MAX_RESPONSE).await?)?;
    pipe.write_all(&[1]).await?;
    if let Some(error) = response.error {
        anyhow::bail!(error);
    }
    Ok(response.result.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pipe_roundtrip_and_first_instance_protection() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path(), "Pipe").unwrap();
        let stop = CancellationToken::new();
        let task = serve(core.clone(), stop.clone()).unwrap();
        assert!(serve(core, CancellationToken::new()).is_err());
        let result = connect(root.path(), Request::Snapshot).await.unwrap();
        assert_eq!(result["identity"]["name"], "Pipe");
        stop.cancel();
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn rejects_anonymous_token_and_oversized_requests_then_remains_usable() {
        use windows_sys::Win32::{
            Security::{ImpersonateAnonymousToken, RevertToSelf},
            System::Threading::GetCurrentThread,
        };
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path(), "Secured pipe").unwrap();
        let stop = CancellationToken::new();
        let task = serve(core, stop.clone()).unwrap();
        let name = pipe_key(root.path(), &user_sid().unwrap()).unwrap();
        let anonymous_name = name.clone();
        let access = tokio::task::spawn_blocking(move || unsafe {
            assert_ne!(ImpersonateAnonymousToken(GetCurrentThread()), 0);
            let result = ClientOptions::new().open(anonymous_name);
            let reverted = RevertToSelf();
            assert_ne!(reverted, 0);
            result.err().map(|error| error.raw_os_error())
        })
        .await
        .unwrap();
        assert_eq!(
            access,
            Some(Some(5)),
            "Anonymous clients must be denied by the pipe DACL"
        );
        let mut malformed = ClientOptions::new().open(name).unwrap();
        malformed.write_u32_le(u32::MAX).await.unwrap();
        let response: Response =
            serde_json::from_slice(&read_frame(&mut malformed, MAX_RESPONSE).await.unwrap())
                .unwrap();
        assert!(response.error.unwrap().contains("size limit"));
        malformed.write_all(&[1]).await.unwrap();
        let result = connect(root.path(), Request::Snapshot).await.unwrap();
        assert_eq!(result["identity"]["name"], "Secured pipe");
        stop.cancel();
        task.await.unwrap().unwrap();
    }
}
