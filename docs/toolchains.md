# Native toolchain pins

Recorded 2026-09-08 for Phase 0 shells. CI must use these or newer patch releases on the same major.

| Tool | Version | Notes |
| --- | --- | --- |
| Bun | 1.3.14 | Package manager and repository scripts. Not the app runtime. |
| Node | 22.13+ | Expo SDK 57 minimum. Local agent used 24/26. |
| TypeScript | 5.9.3 | typescript-eslint 8 requires `<6.1.0`. |
| Expo SDK | 57.0.21 | React Native 0.86, React 19.2.3, Hermes. Development builds only. |
| Tauri | 2.11.x | Vite + React frontend. Rust host. |
| Swift | 6.3.3 | Xcode on macOS CI. |
| Recommended OS floors | iOS 17, Android API 29, macOS 13, Windows 10 1903 + Evergreen WebView2 | Older support is an open Phase 1 question. |

Hermes runs mobile JavaScript. JavaScriptCore or WebView2 runs the desktop frontend. Rust runs the Tauri host and `jot-crypto-core`.
