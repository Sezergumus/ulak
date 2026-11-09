#![allow(non_snake_case)]
use super::Arguments;
use anyhow::{Result, ensure};
use std::{
    ffi::c_void,
    io::Read,
    mem::{ManuallyDrop, size_of},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use ulak_core::{BUFFER_SIZE, Core, auth, client::NativeClient, model::*};
use windows::{
    Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        System::{
            Com::*, DataExchange::RegisterClipboardFormatW, LibraryLoader::GetModuleHandleW,
            Memory::*, Ole::*, SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::{Shell::*, WindowsAndMessaging::*},
    },
    core::{BOOL, Error, HRESULT, Ref, implement, w},
};

fn unsupported<T>() -> windows::core::Result<T> {
    Err(Error::from(E_NOTIMPL))
}

#[derive(Clone)]
struct Source {
    core: Core,
    remote: Remote,
    info: FileInfo,
    http: reqwest::blocking::Client,
    cancelled: Arc<AtomicBool>,
}
impl Source {
    fn new(core: Core, remote: Remote, info: FileInfo, cancelled: Arc<AtomicBool>) -> Result<Self> {
        let http = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .tls_built_in_root_certs(false)
            .add_root_certificate(reqwest::Certificate::from_pem(remote.ca_pem.as_bytes())?)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            core,
            remote,
            info,
            http,
            cancelled,
        })
    }
    fn read_at(&self, offset: u64, buffer: &mut [u8]) -> Result<usize> {
        ensure!(!self.cancelled.load(Ordering::Relaxed), "Drag cancelled");
        if offset >= self.info.size || buffer.is_empty() {
            return Ok(0);
        }
        let length = (buffer.len().min(BUFFER_SIZE) as u64).min(self.info.size - offset) as usize;
        let end = offset + length as u64 - 1;
        let mut url = reqwest::Url::parse(&self.remote.endpoint)?
            .join(&format!("/v1/shares/{}/file", self.info.share_id))?;
        url.query_pairs_mut()
            .append_pair("entry", &self.info.entry_id)
            .append_pair("revision", &self.info.revision);
        let target = format!("{}?{}", url.path(), url.query().unwrap());
        let mut request = self
            .http
            .get(url)
            .header("range", format!("bytes={offset}-{end}"))
            .header("if-match", format!("\"{}\"", self.info.revision));
        if self
            .core
            .read()
            .peers
            .contains_key(&self.remote.identity.id)
        {
            request = request.headers(auth::request_headers(&self.core, "GET", &target)?);
        }
        let mut response = request.send()?;
        ensure!(
            response.status() == reqwest::StatusCode::PARTIAL_CONTENT,
            "Remote range request failed ({})",
            response.status()
        );
        ensure!(
            response.headers().get("etag").and_then(|v| v.to_str().ok())
                == Some(format!("\"{}\"", self.info.revision).as_str()),
            "Remote source changed"
        );
        ensure!(
            response
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                == Some(format!("bytes {offset}-{end}/{}", self.info.size).as_str()),
            "Invalid remote range response"
        );
        ensure!(
            response.content_length() == Some(length as u64),
            "Invalid range length"
        );
        response.read_exact(&mut buffer[..length])?;
        Ok(length)
    }
}

#[implement(IStream)]
struct RemoteStream {
    source: Source,
    position: Mutex<u64>,
}
impl ISequentialStream_Impl for RemoteStream_Impl {
    fn Read(&self, pv: *mut c_void, cb: u32, pcbread: *mut u32) -> HRESULT {
        if !pcbread.is_null() {
            unsafe {
                *pcbread = 0;
            }
        }
        if cb == 0 {
            return S_OK;
        }
        if pv.is_null() {
            return E_POINTER;
        }
        let requested = cb as usize;
        let output = unsafe { std::slice::from_raw_parts_mut(pv.cast::<u8>(), requested) };
        let mut position = self.position.lock().unwrap();
        let mut total = 0usize;
        while total < requested {
            match self.source.read_at(*position, &mut output[total..]) {
                Ok(0) => break,
                Ok(length) => {
                    *position += length as u64;
                    total += length;
                    if !pcbread.is_null() {
                        unsafe {
                            *pcbread = total as u32;
                        }
                    }
                }
                Err(error) => {
                    eprintln!("Remote drag read failed: {error:#}");
                    return E_FAIL;
                }
            }
        }
        if total == requested { S_OK } else { S_FALSE }
    }
    fn Write(&self, _: *const c_void, _: u32, _: *mut u32) -> HRESULT {
        STG_E_ACCESSDENIED
    }
}
impl IStream_Impl for RemoteStream_Impl {
    fn Seek(
        &self,
        movement: i64,
        origin: STREAM_SEEK,
        result: *mut u64,
    ) -> windows::core::Result<()> {
        let mut position = self.position.lock().unwrap();
        let base = match origin {
            STREAM_SEEK_SET => 0,
            STREAM_SEEK_CUR => *position as i128,
            STREAM_SEEK_END => self.source.info.size as i128,
            _ => return Err(Error::from(STG_E_INVALIDFUNCTION)),
        };
        let target = base + movement as i128;
        if target < 0 || target > u64::MAX as i128 {
            return Err(Error::from(STG_E_INVALIDFUNCTION));
        }
        *position = target as u64;
        if !result.is_null() {
            unsafe {
                *result = *position;
            }
        }
        Ok(())
    }
    fn SetSize(&self, _: u64) -> windows::core::Result<()> {
        Err(Error::from(STG_E_ACCESSDENIED))
    }
    fn CopyTo(
        &self,
        destination: Ref<'_, IStream>,
        count: u64,
        read_total: *mut u64,
        written_total: *mut u64,
    ) -> windows::core::Result<()> {
        let destination = destination.as_ref().ok_or_else(|| Error::from(E_POINTER))?;
        let mut read = 0u64;
        let mut written = 0u64;
        if !read_total.is_null() {
            unsafe {
                *read_total = 0;
            }
        }
        if !written_total.is_null() {
            unsafe {
                *written_total = 0;
            }
        }
        let mut buffer = vec![0u8; BUFFER_SIZE];
        while read < count {
            let mut length = 0u32;
            let result = self.Read(
                buffer.as_mut_ptr().cast(),
                ((count - read).min(BUFFER_SIZE as u64)) as u32,
                &mut length,
            );
            result.ok()?;
            if length == 0 {
                break;
            }
            read += length as u64;
            let mut offset = 0u32;
            while offset < length {
                let mut copied = 0u32;
                unsafe {
                    destination
                        .Write(
                            buffer.as_ptr().add(offset as usize).cast(),
                            length - offset,
                            Some(&mut copied),
                        )
                        .ok()?;
                }
                if copied == 0 {
                    return Err(Error::from(STG_E_WRITEFAULT));
                }
                offset += copied;
                written += copied as u64;
            }
            if !read_total.is_null() {
                unsafe {
                    *read_total = read;
                }
            }
            if !written_total.is_null() {
                unsafe {
                    *written_total = written;
                }
            }
        }
        Ok(())
    }
    fn Commit(&self, _: &STGC) -> windows::core::Result<()> {
        Ok(())
    }
    fn Revert(&self) -> windows::core::Result<()> {
        unsupported()
    }
    fn LockRegion(&self, _: u64, _: u64, _: &LOCKTYPE) -> windows::core::Result<()> {
        unsupported()
    }
    fn UnlockRegion(&self, _: u64, _: u64, _: u32) -> windows::core::Result<()> {
        unsupported()
    }
    fn Stat(&self, result: *mut STATSTG, _: &STATFLAG) -> windows::core::Result<()> {
        if result.is_null() {
            return Err(Error::from(E_POINTER));
        }
        unsafe {
            *result = STATSTG {
                r#type: STGTY_STREAM.0 as u32,
                cbSize: self.source.info.size,
                grfMode: STGM_READ,
                ..Default::default()
            };
        }
        Ok(())
    }
    fn Clone(&self) -> windows::core::Result<IStream> {
        Ok(RemoteStream {
            source: self.source.clone(),
            position: Mutex::new(*self.position.lock().unwrap()),
        }
        .into())
    }
}

#[implement(IDataObject)]
struct Files {
    sources: Vec<Source>,
    descriptor_format: u16,
    content_format: u16,
}
impl Files {
    fn formats(&self) -> [FORMATETC; 2] {
        [
            FORMATETC {
                cfFormat: self.descriptor_format,
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
                ..Default::default()
            },
            FORMATETC {
                cfFormat: self.content_format,
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_ISTREAM.0 as u32,
                ..Default::default()
            },
        ]
    }
}
impl IDataObject_Impl for Files_Impl {
    fn GetData(&self, format: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
        self.QueryGetData(format).ok()?;
        let format = unsafe { &*format };
        if format.cfFormat == self.descriptor_format {
            let size = 4 + self.sources.len() * size_of::<FILEDESCRIPTORW>();
            let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size)? };
            let pointer = unsafe { GlobalLock(memory) };
            if pointer.is_null() {
                unsafe {
                    let _ = GlobalFree(Some(memory));
                }
                return Err(Error::from(E_OUTOFMEMORY));
            }
            unsafe {
                pointer.cast::<u32>().write(self.sources.len() as u32);
            }
            for (index, source) in self.sources.iter().enumerate() {
                let mut descriptor = FILEDESCRIPTORW {
                    dwFlags: (FD_FILESIZE.0 | FD_ATTRIBUTES.0 | FD_UNICODE.0) as u32,
                    dwFileAttributes: 0x80,
                    nFileSizeHigh: (source.info.size >> 32) as u32,
                    nFileSizeLow: source.info.size as u32,
                    ..Default::default()
                };
                let name: Vec<u16> = source.info.name.encode_utf16().take(259).collect();
                let mut filename = [0u16; 260];
                filename[..name.len()].copy_from_slice(&name);
                descriptor.cFileName = filename;
                unsafe {
                    pointer
                        .cast::<u8>()
                        .add(4 + index * size_of::<FILEDESCRIPTORW>())
                        .cast::<FILEDESCRIPTORW>()
                        .write_unaligned(descriptor);
                }
            }
            unsafe {
                let _ = GlobalUnlock(memory);
            }
            Ok(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: memory },
                ..Default::default()
            })
        } else {
            let source = self.sources[format.lindex as usize].clone();
            let stream: IStream = RemoteStream {
                source,
                position: Mutex::new(0),
            }
            .into();
            Ok(STGMEDIUM {
                tymed: TYMED_ISTREAM.0 as u32,
                u: STGMEDIUM_0 {
                    pstm: ManuallyDrop::new(Some(stream)),
                },
                ..Default::default()
            })
        }
    }
    fn GetDataHere(&self, _: *const FORMATETC, _: *mut STGMEDIUM) -> windows::core::Result<()> {
        unsupported()
    }
    fn QueryGetData(&self, format: *const FORMATETC) -> HRESULT {
        if format.is_null() {
            return E_POINTER;
        }
        let format = unsafe { &*format };
        if format.dwAspect != DVASPECT_CONTENT.0 {
            return DV_E_DVASPECT;
        }
        if format.cfFormat == self.descriptor_format && format.tymed & TYMED_HGLOBAL.0 as u32 != 0 {
            return S_OK;
        }
        if format.cfFormat == self.content_format && format.tymed & TYMED_ISTREAM.0 as u32 != 0 {
            return if format.lindex >= 0 && (format.lindex as usize) < self.sources.len() {
                S_OK
            } else {
                DV_E_LINDEX
            };
        }
        DV_E_FORMATETC
    }
    fn GetCanonicalFormatEtc(&self, _: *const FORMATETC, output: *mut FORMATETC) -> HRESULT {
        if !output.is_null() {
            unsafe {
                (*output).ptd = std::ptr::null_mut();
            }
        }
        E_NOTIMPL
    }
    fn SetData(
        &self,
        _: *const FORMATETC,
        _: *const STGMEDIUM,
        _: BOOL,
    ) -> windows::core::Result<()> {
        unsupported()
    }
    fn EnumFormatEtc(&self, direction: u32) -> windows::core::Result<IEnumFORMATETC> {
        if direction != DATADIR_GET.0 as u32 {
            return unsupported();
        }
        unsafe { SHCreateStdEnumFmtEtc(&self.formats()) }
    }
    fn DAdvise(
        &self,
        _: *const FORMATETC,
        _: u32,
        _: Ref<'_, IAdviseSink>,
    ) -> windows::core::Result<u32> {
        Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
    }
    fn DUnadvise(&self, _: u32) -> windows::core::Result<()> {
        Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
    }
    fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
        Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
    }
}

#[implement(IDropSource)]
struct DragSource {
    cancelled: Arc<AtomicBool>,
}
impl IDropSource_Impl for DragSource_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape.as_bool() {
            self.cancelled.store(true, Ordering::Relaxed);
            DRAGDROP_S_CANCEL
        } else if keys.0 & 1 == 0 {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }
    fn GiveFeedback(&self, _: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

struct WindowData {
    sources: Vec<Source>,
}
unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            WM_NCCREATE => {
                let create = &*(lparam.0 as *const CREATESTRUCTW);
                SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
                LRESULT(1)
            }
            WM_PAINT => {
                let mut paint = PAINTSTRUCT::default();
                let dc = BeginPaint(window, &mut paint);
                let text: Vec<u16> = "Drag from this area into an Explorer folder. Escape cancels."
                    .encode_utf16()
                    .collect();
                let _ = TextOutW(dc, 16, 24, &text);
                let _ = EndPaint(window, &paint);
                LRESULT(0)
            }
            WM_LBUTTONDOWN => {
                let data = &*(GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowData);
                let cancelled = Arc::new(AtomicBool::new(false));
                let sources = data
                    .sources
                    .iter()
                    .cloned()
                    .map(|mut source| {
                        source.cancelled = cancelled.clone();
                        source
                    })
                    .collect();
                let files: IDataObject = Files {
                    sources,
                    descriptor_format: RegisterClipboardFormatW(w!("FileGroupDescriptorW")) as u16,
                    content_format: RegisterClipboardFormatW(w!("FileContents")) as u16,
                }
                .into();
                let source: IDropSource = DragSource { cancelled }.into();
                let mut effect = DROPEFFECT_NONE;
                let result = DoDragDrop(&files, &source, DROPEFFECT_COPY, &mut effect);
                println!("Drag result: {result:?}; effect: {}", effect.0);
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }
}

pub fn run(arguments: Arguments) -> Result<()> {
    ensure!(
        !arguments.entry.is_empty() && arguments.entry.len() <= 64,
        "Select between 1 and 64 files"
    );
    let core = Core::open(&arguments.data, "Ulak drag probe")?;
    let remote: Remote = serde_json::from_reader(std::fs::File::open(&arguments.remote)?)?;
    let runtime = tokio::runtime::Runtime::new()?;
    let client = NativeClient::new(core.clone(), remote.clone())?;
    let infos = runtime.block_on(async {
        client.verify().await?;
        let mut result = Vec::new();
        for entry in &arguments.entry {
            result.push(client.prepare(&arguments.share, entry).await?);
        }
        Ok::<_, anyhow::Error>(result)
    })?;
    let sources = infos
        .into_iter()
        .map(|info| {
            Source::new(
                core.clone(),
                remote.clone(),
                info,
                Arc::new(AtomicBool::new(false)),
            )
        })
        .collect::<Result<Vec<_>>>()?;
    let data = Box::new(WindowData { sources });
    unsafe {
        OleInitialize(None)?;
        let instance = GetModuleHandleW(None)?;
        let class = w!("UlakVirtualFileProbe");
        let definition = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: class,
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            hbrBackground: HBRUSH((COLOR_WINDOW.0 + 1) as *mut _),
            ..Default::default()
        };
        ensure!(
            RegisterClassW(&definition) != 0,
            "Could not register drag probe window"
        );
        let _window = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            w!("Ulak virtual-file streaming probe"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            620,
            180,
            None,
            None,
            Some(instance.into()),
            Some((&*data as *const WindowData).cast()),
        )?;
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        OleUninitialize();
    }
    drop(data);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn virtual_stream_exposes_size_seek_and_independent_clones_without_staging() {
        let directory = tempfile::tempdir().unwrap();
        let core = Core::open(directory.path(), "Probe").unwrap();
        let remote = core.descriptor("https://127.0.0.1:7443/").unwrap();
        let info = FileInfo {
            share_id: "share".into(),
            entry_id: "entry".into(),
            name: "large.bin".into(),
            size: 50_000_000_000,
            revision: "revision".into(),
            digest: "digest".into(),
        };
        let source = Source::new(core, remote, info, Arc::new(AtomicBool::new(false))).unwrap();
        let stream: IStream = RemoteStream {
            source,
            position: Mutex::new(0),
        }
        .into();
        unsafe {
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME).unwrap();
            assert_eq!(stat.cbSize, 50_000_000_000);
            let mut offset = 0;
            stream.Seek(-4, STREAM_SEEK_END, Some(&mut offset)).unwrap();
            assert_eq!(offset, 49_999_999_996);
            let clone = stream.Clone().unwrap();
            clone.Seek(0, STREAM_SEEK_SET, Some(&mut offset)).unwrap();
            assert_eq!(offset, 0);
            stream.Seek(0, STREAM_SEEK_CUR, Some(&mut offset)).unwrap();
            assert_eq!(offset, 49_999_999_996);
            assert!(stream.Seek(-1, STREAM_SEEK_SET, None).is_err());
        }
    }
}
