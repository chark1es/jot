//! Shared cryptography core.
//!
//! Phase 0 only proves the crate builds and the pinned crates link.
//! Argon2id + XChaCha20-Poly1305 envelope sealing lands in Phase 3.

use zeroize::Zeroize;

/// XChaCha20-Poly1305 nonce length in bytes.
pub const XCHACHA_NONCE_LEN: usize = 24;

/// Returns true when this crate is linked into a Jolt target.
pub fn rust_core_available() -> bool {
    true
}

/// Phase 3 will Argon2id-derive a key and XChaCha20-Poly1305-seal a payload.
///
/// This placeholder only allocates a 24-byte nonce so getrandom and the
/// XChaCha nonce length stay in the build. It does not encrypt.
pub fn seal_placeholder() -> [u8; XCHACHA_NONCE_LEN] {
    let mut nonce = [0u8; XCHACHA_NONCE_LEN];
    getrandom::fill(&mut nonce).expect("os rng");
    nonce
}

/// Zeroizes a stack buffer. Phase 3 will use this on key material.
pub fn wipe_secret(secret: &mut [u8]) {
    secret.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_core_is_available() {
        assert!(rust_core_available());
    }

    #[test]
    fn argon2_and_xchacha_link() {
        let _hasher = argon2::Argon2::default();
        assert_eq!(
            core::mem::size_of::<chacha20poly1305::XNonce>(),
            XCHACHA_NONCE_LEN
        );
        assert_eq!(XCHACHA_NONCE_LEN, 24);

        // Keep AEAD, HMAC, HKDF, and SHA-2 in the crate graph.
        let _ = core::any::type_name::<chacha20poly1305::XChaCha20Poly1305>();
        let _ = core::any::type_name::<hmac::Hmac<sha2::Sha256>>();
        let _ = core::any::type_name::<hkdf::Hkdf<sha2::Sha256>>();
        let _ = core::any::type_name::<aead::Error>();

        let nonce = seal_placeholder();
        assert_eq!(nonce.len(), XCHACHA_NONCE_LEN);
    }
}
