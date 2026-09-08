# ADR 0002: Expo mobile and Tauri desktop

Status: accepted  
Date: 2026-09-08

## Decision

Ship iOS and Android as Expo development builds with Metro. Ship macOS and Windows as Tauri v2 with Vite. There is no web target and no Tauri mobile in v1.

## Why

React Native is not a DOM runtime. The product forbids a WebView editor on mobile. Tauri mobile would still need `UITextView` and `EditText` beside a WebView, which erases the one-codebase saving at the hardest part of the product.

## Consequences

Two bundlers, two persistence adapters, and two editor implementations. Shared work lives in platform-agnostic packages. Native iOS and Android projects are generated, then owned once share extensions and widgets make continuous prebuild unsafe.
