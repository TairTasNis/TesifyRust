//! CLI-прототип использует тот же рабочий PlayEngine, что и Backend.
#[path = "../Backend/src/shared/playback/play_engine.rs"]
mod implementation;
pub use implementation::*;
