use super::Arguments;
use anyhow::{Result, ensure};
use ulak_core::{Core, client::NativeClient, model::*};
use windows::{
    Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        System::{LibraryLoader::GetModuleHandleW, Ole::*},
        UI::WindowsAndMessaging::*,
    },
    core::w,
};
struct WindowData {
    core: Core,
    remote: Remote,
    infos: Vec<FileInfo>,
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
                println!(
                    "Drag result: {:?}",
                    ulak_drag_probe::drag_files(
                        data.core.clone(),
                        data.remote.clone(),
                        data.infos.clone()
                    )
                );
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
    let data = Box::new(WindowData {
        core,
        remote,
        infos,
    });
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
        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        OleUninitialize();
    }
    drop(data);
    Ok(())
}
