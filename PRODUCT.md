# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Bun workspaces and Turborepo. TypeScript is strict and committed TypeScript contains no `any`. The mobile application uses Expo development builds, Expo Router, React Native, Metro, NativeWind, Swift, and Kotlin. The desktop application uses Tauri v2, Vite, React, Tailwind, and Rust. There is no web target.

## Users

People who want a fast personal notes application across phones and computers, retain ownership of their files, and do not want the product operator to receive their notes or operate an account system.

## Product purpose

Jot captures, organizes, finds, and restores personal notes. It works offline, treats local storage as authoritative, and uses the user's Google Drive as a transport between their devices.

## Positioning

Jot combines a native mobile writing surface with a local-first data model, user-owned Drive sync, and optional end-to-end encryption. A Jot-operated relay coordinates change notifications. Official Jot clients never send it user content or Google Drive credentials, and it has no content-ingestion interface or means to fetch Drive files. Google can read unencrypted Drive content. The Jot operator and relay cannot.

## Operating context

Users capture short notes through the application, share sheet, widget, or quick-capture entry point. They also maintain long structured notes with formatting, images, files, code, and math. Devices can remain offline and edit the same note before reconnecting.

## Capabilities and constraints

- iOS and Android have first priority. macOS and Windows follow.
- Mobile editing uses `UITextView` with TextKit 2 on iOS and `EditText` with `Spannable` on Android through one Expo native module contract.
- Desktop editing uses ProseMirror through TipTap in the Tauri WebView.
- No mobile text-input path may use a WebView.
- Notes persist locally and autosave. There is no explicit save action.
- Google Drive is the first remote storage provider. The user grants `drive.file`, and Jot stores data in a visible folder.
- Jot operates a content-blind sync relay with a small metadata database. Official clients do not send it user content, encryption keys, Google identity, or Google Drive credentials. It stores none of those fields and does not provide an account system.
- Sync correctness never depends on the relay. Clients transfer data directly to Google Drive and fall back to Drive change polling when the relay is unavailable.
- Jot operates no collaboration system or remote error-reporting service.
- Collaboration, public sharing, handwriting, drawing, scanning, voice memos, and smart folders are outside v1.
- Data integrity has priority over feature breadth and visual polish.

## Brand commitments

The product is named Jot. It should feel fast, quiet, capable, and crafted. The writing surface matters more than application chrome. Avoid decorative gradients, glass effects, emoji iconography, and floating rounded-card layouts.

## Evidence on hand

The repository contains no implementation, product assets, user research, benchmarks, or production data. Future work must not invent performance claims or user evidence.

## Product principles

- Never trade user data for convenience.
- Keep editing native on mobile and immediate on every platform.
- Make offline behavior complete and sync state honest.
- Keep user data portable and recoverable without Jot infrastructure.
- Add capability without making the writing surface noisy.

## Accessibility and inclusion

Support system light and dark modes, Dynamic Type on Apple platforms, Android font scaling, keyboard navigation on desktop, screen readers, reduced motion, high contrast, and touch targets appropriate to each platform.
