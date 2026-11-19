#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetErrorMode() -> u32;
            fn SetErrorMode(mode: u32) -> u32;
        }
        const SEM_FAILCRITICALERRORS: u32 = 0x0001;
        // Set this at startup, before threads or child processes are created.
        // Helper failures flow through the normal playback error handling.
        unsafe { SetErrorMode(GetErrorMode() | SEM_FAILCRITICALERRORS) };
    }
    tesify_lib::run();
}
