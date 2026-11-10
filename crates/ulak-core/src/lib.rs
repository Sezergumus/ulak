pub mod auth;
pub mod catalog;
pub mod client;
pub mod discovery;
pub mod download;
pub mod identity;
pub mod model;
pub mod pairing;
pub mod server;
pub mod storage;

pub use storage::Core;
pub const PROTOCOL_VERSION: u32 = 1;
pub const BUFFER_SIZE: usize = 64 * 1024;
pub const MAX_TRANSFERS: usize = 4;
pub const MAX_HASH_JOBS: usize = 2;
pub const MAX_PAGE_SIZE: usize = 100;
pub const MAX_RECORDS: usize = 4096;
