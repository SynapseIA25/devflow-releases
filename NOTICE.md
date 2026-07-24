# Third-Party Notices

DevFlow (este software) usa las siguientes dependencias de código abierto. Se listan a
continuación con su nombre, versión y licencia SPDX. El texto completo de cada licencia
está disponible en el registro/repositorio de cada paquete (npm o crates.io).

Generado automáticamente por `scripts/generate-third-party-notices.mjs` a partir de
`package-lock.json` (dependencias de producción, sin devDependencies) y `cargo metadata`
(`src-tauri/Cargo.toml`). Volver a correr ese script antes de cada release para mantenerlo
al día.

---

## Componentes bundleados destacados

### OpenCode (MIT)
DevFlow bundlea el binario de OpenCode como sidecar (ver `scripts/fetch-opencode-sidecar.mjs`)
para el motor de código nativo "DevFlow Code". Repositorio: https://github.com/sst/opencode
(licencia MIT).

### mobile-mcp (Apache-2.0)
DevFlow invoca `@mobilenext/mobile-mcp` vía `npx` en tiempo de ejecución (no vendoreado en el
bundle) para verificación de apps móviles. Repositorio: https://github.com/mobile-next/mobile-mcp
(licencia Apache-2.0).

---

## Dependencias npm (172 paquetes)

### Apache-2.0 OR MIT

- @tauri-apps/api@2.11.1

### BSD-3-Clause

- d3-ease@3.0.1

### ISC

- @ungap/structured-clone@1.3.1
- d3-color@3.1.0
- d3-dispatch@3.0.1
- d3-drag@3.0.0
- d3-interpolate@3.0.1
- d3-selection@3.0.0
- d3-timer@3.0.1
- d3-transition@3.0.1
- d3-zoom@3.0.0
- isexe@2.0.0
- lucide-react@1.21.0
- which@2.0.2

### MIT

- @codemirror/autocomplete@6.20.3
- @codemirror/commands@6.10.4
- @codemirror/lang-css@6.3.1
- @codemirror/lang-html@6.4.11
- @codemirror/lang-javascript@6.2.5
- @codemirror/lang-json@6.0.2
- @codemirror/lang-markdown@6.5.0
- @codemirror/lang-python@6.2.1
- @codemirror/lang-rust@6.0.2
- @codemirror/language@6.12.4
- @codemirror/legacy-modes@6.5.3
- @codemirror/lint@6.9.7
- @codemirror/search@6.7.1
- @codemirror/state@6.7.0
- @codemirror/theme-one-dark@6.1.3
- @codemirror/view@6.43.4
- @lezer/common@1.5.2
- @lezer/css@1.3.4
- @lezer/highlight@1.2.3
- @lezer/html@1.3.13
- @lezer/javascript@1.5.4
- @lezer/json@1.0.3
- @lezer/lr@1.4.10
- @lezer/markdown@1.6.4
- @lezer/python@1.1.19
- @lezer/rust@1.0.2
- @marijn/find-cluster-break@1.0.3
- @opencode-ai/sdk@1.18.3
- @types/d3-color@3.1.3
- @types/d3-drag@3.0.7
- @types/d3-interpolate@3.0.4
- @types/d3-selection@3.0.11
- @types/d3-transition@3.0.9
- @types/d3-zoom@3.0.8
- @types/debug@4.1.13
- @types/estree@1.0.9
- @types/estree-jsx@1.0.5
- @types/hast@3.0.4
- @types/mdast@4.0.4
- @types/ms@2.1.0
- @types/react@19.2.17
- @types/react-dom@19.2.3
- @types/unist@3.0.3
- @types/unist@2.0.11
- @xterm/addon-fit@0.11.0
- @xterm/xterm@6.0.0
- @xyflow/react@12.11.0
- @xyflow/system@0.0.77
- bail@2.0.2
- ccount@2.0.1
- character-entities@2.0.2
- character-entities-html4@2.1.0
- character-entities-legacy@3.0.0
- character-reference-invalid@2.0.1
- classcat@5.0.5
- codemirror@6.0.2
- comma-separated-tokens@2.0.3
- crelt@1.0.7
- cross-spawn@7.0.6
- csstype@3.2.3
- debug@4.4.3
- decode-named-character-reference@1.3.0
- dequal@2.0.3
- devlop@1.1.0
- escape-string-regexp@5.0.0
- estree-util-is-identifier-name@3.0.0
- extend@3.0.2
- hast-util-to-jsx-runtime@2.3.6
- hast-util-whitespace@3.0.0
- html-url-attributes@3.0.1
- inline-style-parser@0.2.7
- is-alphabetical@2.0.1
- is-alphanumerical@2.0.1
- is-decimal@2.0.1
- is-hexadecimal@2.0.1
- is-plain-obj@4.1.0
- longest-streak@3.1.0
- markdown-table@3.0.4
- mdast-util-find-and-replace@3.0.2
- mdast-util-from-markdown@2.0.3
- mdast-util-gfm@3.1.0
- mdast-util-gfm-autolink-literal@2.0.1
- mdast-util-gfm-footnote@2.1.0
- mdast-util-gfm-strikethrough@2.0.0
- mdast-util-gfm-table@2.0.0
- mdast-util-gfm-task-list-item@2.0.0
- mdast-util-mdx-expression@2.0.1
- mdast-util-mdx-jsx@3.2.0
- mdast-util-mdxjs-esm@2.0.1
- mdast-util-phrasing@4.1.0
- mdast-util-to-hast@13.2.1
- mdast-util-to-markdown@2.1.2
- mdast-util-to-string@4.0.0
- micromark@4.0.2
- micromark-core-commonmark@2.0.3
- micromark-extension-gfm@3.0.0
- micromark-extension-gfm-autolink-literal@2.1.0
- micromark-extension-gfm-footnote@2.1.0
- micromark-extension-gfm-strikethrough@2.1.0
- micromark-extension-gfm-table@2.1.1
- micromark-extension-gfm-tagfilter@2.0.0
- micromark-extension-gfm-task-list-item@2.1.0
- micromark-factory-destination@2.0.1
- micromark-factory-label@2.0.1
- micromark-factory-space@2.0.1
- micromark-factory-title@2.0.1
- micromark-factory-whitespace@2.0.1
- micromark-util-character@2.1.1
- micromark-util-chunked@2.0.1
- micromark-util-classify-character@2.0.1
- micromark-util-combine-extensions@2.0.1
- micromark-util-decode-numeric-character-reference@2.0.2
- micromark-util-decode-string@2.0.1
- micromark-util-encode@2.0.1
- micromark-util-html-tag-name@2.0.1
- micromark-util-normalize-identifier@2.0.1
- micromark-util-resolve-all@2.0.1
- micromark-util-sanitize-uri@2.0.1
- micromark-util-subtokenize@2.1.0
- micromark-util-symbol@2.0.1
- micromark-util-types@2.0.2
- ms@2.1.3
- parse-entities@4.0.2
- path-key@3.1.1
- property-information@7.2.0
- react@19.2.7
- react-dom@19.2.7
- react-markdown@10.1.0
- remark-gfm@4.0.1
- remark-parse@11.0.0
- remark-rehype@11.1.2
- remark-stringify@11.0.0
- scheduler@0.27.0
- shebang-command@2.0.0
- shebang-regex@3.0.0
- space-separated-tokens@2.0.2
- stringify-entities@4.0.4
- style-mod@4.1.3
- style-to-js@1.1.21
- style-to-object@1.0.14
- trim-lines@3.0.1
- trough@2.2.0
- unified@11.0.5
- unist-util-is@6.0.1
- unist-util-position@5.0.0
- unist-util-stringify-position@4.0.0
- unist-util-visit@5.1.0
- unist-util-visit-parents@6.0.2
- use-sync-external-store@1.6.0
- vfile@6.0.3
- vfile-message@4.0.3
- w3c-keyname@2.2.8
- zustand@4.5.7
- zustand@5.0.14
- zwitch@2.0.4

### MIT OR Apache-2.0

- @tauri-apps/plugin-opener@2.5.4
- @tauri-apps/plugin-process@2.3.1
- @tauri-apps/plugin-updater@2.10.1

## Dependencias cargo (Rust) (573 paquetes)

### (Apache-2.0 OR MIT) AND BSD-3-Clause

- encoding_rs@0.8.35

### (MIT OR Apache-2.0) AND Unicode-3.0

- unicode-ident@1.0.24

### 0BSD OR MIT OR Apache-2.0

- adler2@2.0.1

### Apache-2.0

- sync_wrapper@1.0.2
- tao@0.35.3

### Apache-2.0 / MIT

- fnv@1.0.7

### Apache-2.0 AND ISC

- ring@0.17.14

### Apache-2.0 AND MIT

- dpi@0.1.2

### Apache-2.0 OR BSL-1.0

- ryu@1.0.23

### Apache-2.0 OR ISC OR MIT

- hyper-rustls@0.27.9
- rustls@0.23.41
- rustls-native-certs@0.8.4

### Apache-2.0 OR MIT

- ascii@1.1.0
- async-channel@2.5.0
- async-executor@1.14.0
- async-fs@2.2.0
- async-io@2.6.0
- async-lock@3.4.2
- async-net@2.0.0
- async-process@2.5.0
- async-signal@0.2.14
- async-task@4.7.1
- atomic-waker@1.1.2
- autocfg@1.5.1
- bit-set@0.8.0
- bit-vec@0.8.0
- blocking@1.6.2
- cargo_toml@0.22.3
- concurrent-queue@2.5.0
- ctor@0.8.0
- ctor-proc-macro@0.0.7
- dtor@0.3.0
- dtor-proc-macro@0.0.6
- equivalent@1.0.2
- event-listener@5.4.1
- event-listener-strategy@0.5.4
- fastrand@2.4.1
- futures-lite@2.6.1
- idna_adapter@1.2.2
- indexmap@1.9.3
- indexmap@2.14.0
- libappindicator@0.9.0
- libappindicator-sys@0.9.0
- muda@0.19.3
- parking@2.2.1
- pin-project-lite@0.2.17
- polling@3.11.0
- rustc-hash@2.1.2
- simd_cesu8@1.1.1
- tauri@2.11.3
- tauri-build@2.6.3
- tauri-codegen@2.6.3
- tauri-macros@2.6.3
- tauri-plugin@2.6.3
- tauri-plugin-opener@2.5.4
- tauri-plugin-process@2.3.1
- tauri-plugin-updater@2.10.1
- tauri-runtime@2.11.3
- tauri-runtime-wry@2.11.3
- tauri-utils@2.9.3
- utf8_iter@1.0.4
- uuid@1.23.3
- window-vibrancy@0.6.0
- wry@0.55.1
- zeroize@1.9.0

### Apache-2.0 WITH LLVM-exception

- target-lexicon@0.12.16

### Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT

- linux-raw-sys@0.12.1
- rustix@1.1.4
- wasi@0.11.1+wasi-snapshot-preview1
- wasip2@1.0.4+wasi-0.2.12
- wit-bindgen@0.57.1

### Apache-2.0/MIT

- cesu8@1.1.0
- dbus@0.9.11
- libdbus-sys@0.2.7
- pollster@0.4.0
- shared_library@0.1.9

### BSD-2-Clause OR Apache-2.0

- serial2@0.2.37

### BSD-2-Clause OR Apache-2.0 OR MIT

- zerocopy@0.8.52
- zerocopy-derive@0.8.52

### BSD-3-Clause

- alloc-no-stdlib@2.0.4
- alloc-stdlib@0.2.4
- subtle@2.6.1

### BSD-3-Clause AND MIT

- brotli@8.0.4

### BSD-3-Clause OR MIT OR Apache-2.0

- num_enum@0.7.6
- num_enum_derive@0.7.6

### BSD-3-Clause/MIT

- brotli-decompressor@5.0.3

### CC0-1.0

- notify@6.1.1

### CC0-1.0 OR MIT-0 OR Apache-2.0

- dunce@1.0.5

### CDLA-Permissive-2.0

- webpki-root-certs@1.0.8
- webpki-roots@1.0.8

### ISC

- inotify@0.9.6
- inotify-sys@0.1.7
- libloading@0.7.4
- rustls-webpki@0.103.13
- untrusted@0.9.0

### MIT

- ashpd@0.11.1
- atk@0.18.2
- atk-sys@0.18.2
- block2@0.6.2
- bytes@1.12.0
- cairo-rs@0.18.5
- cairo-sys-rs@0.18.2
- cargo_metadata@0.19.2
- cfb@0.7.3
- cfg_aliases@0.1.1
- cfg_aliases@0.2.1
- combine@4.6.7
- darling@0.23.0
- darling_core@0.23.0
- darling_macro@0.23.0
- derive_more@2.1.1
- derive_more-impl@2.1.1
- dlib@0.5.3
- dlopen2@0.8.2
- dlopen2_derive@0.4.3
- dom_query@0.27.0
- embed-resource@3.0.9
- endi@1.1.1
- filedescriptor@0.8.3
- fsevent-sys@4.1.0
- gdk@0.18.2
- gdk-pixbuf@0.18.5
- gdk-pixbuf-sys@0.18.0
- gdk-sys@0.18.2
- gdkwayland-sys@0.18.2
- gdkx11@0.18.2
- gdkx11-sys@0.18.2
- generic-array@0.14.7
- gio@0.18.4
- gio-sys@0.18.1
- glib@0.18.5
- glib-macros@0.18.5
- glib-sys@0.18.1
- gobject-sys@0.18.0
- gtk@0.18.2
- gtk-sys@0.18.2
- gtk3-macros@0.18.2
- h2@0.4.15
- http-body@1.0.1
- http-body-util@0.1.3
- hyper@1.10.1
- hyper-util@0.1.20
- ico@0.5.0
- infer@0.19.0
- is-docker@0.2.0
- is-wsl@0.4.0
- javascriptcore-rs@1.1.2
- javascriptcore-rs-sys@1.1.1
- kqueue@1.2.0
- kqueue-sys@1.1.2
- libredox@0.1.17
- memoffset@0.9.1
- minisign-verify@0.2.5
- mio@0.8.11
- mio@1.2.1
- new_debug_unreachable@1.0.6
- nix@0.28.0
- objc2@0.6.4
- objc2-encode@4.1.0
- objc2-foundation@0.3.2
- open@5.3.5
- pango@0.18.3
- pango-sys@0.18.0
- phf@0.13.1
- phf_codegen@0.13.1
- phf_generator@0.13.1
- phf_macros@0.13.1
- phf_shared@0.13.1
- plist@1.9.0
- portable-pty@0.9.0
- precomputed-hash@0.1.1
- quick-xml@0.39.4
- redox_syscall@0.5.18
- redox_users@0.5.2
- rfd@0.15.4
- schannel@0.1.29
- schemars@0.8.22
- schemars@0.9.0
- schemars@1.2.1
- schemars_derive@0.8.22
- simd-adler32@0.3.9
- slab@0.4.12
- soup3@0.5.0
- soup3-sys@0.5.0
- strsim@0.11.1
- synstructure@0.13.2
- tauri-winres@0.3.6
- tokio@1.52.3
- tokio-macros@2.7.0
- tokio-util@0.7.18
- tower@0.5.3
- tower-http@0.6.11
- tower-layer@0.3.3
- tower-service@0.3.3
- tracing@0.1.44
- tracing-attributes@0.1.31
- tracing-core@0.1.36
- try-lock@0.2.5
- uds_windows@1.2.1
- urlencoding@2.1.3
- urlpattern@0.3.0
- version-compare@0.2.1
- vswhom@0.1.0
- vswhom-sys@0.1.3
- want@0.3.1
- wayland-backend@0.3.15
- wayland-client@0.31.14
- wayland-protocols@0.32.13
- wayland-scanner@0.31.10
- wayland-sys@0.31.11
- webkit2gtk@2.0.2
- webkit2gtk-sys@2.0.2
- webview2-com@0.38.2
- webview2-com-macros@0.8.1
- webview2-com-sys@0.38.2
- winnow@0.5.40
- winnow@0.7.15
- winnow@1.0.3
- winreg@0.10.1
- winreg@0.55.0
- x11@2.21.0
- x11-dl@2.21.0
- zbus@5.16.0
- zbus_macros@5.16.0
- zbus_names@4.3.2
- zip@4.6.1
- zmij@1.0.21
- zvariant@5.12.0
- zvariant_derive@5.12.0
- zvariant_utils@3.4.0

### MIT OR Apache-2.0

- anyhow@1.0.102
- arbitrary@1.4.2
- async-broadcast@0.7.2
- async-compression@0.4.42
- async-recursion@1.1.1
- async-trait@0.1.89
- base64@0.21.7
- base64@0.22.1
- bitflags@2.13.0
- block-buffer@0.10.4
- bumpalo@3.20.3
- camino@1.2.3
- cargo-platform@0.1.9
- cc@1.2.65
- cfg-expr@0.15.8
- cfg-if@1.0.4
- chacha20@0.10.1
- chrono@0.4.45
- chunked_transfer@1.5.0
- compression-codecs@0.4.38
- compression-core@0.4.32
- cookie@0.18.1
- core-foundation@0.10.1
- core-foundation-sys@0.8.7
- core-graphics@0.25.0
- core-graphics-types@0.2.0
- cpufeatures@0.2.17
- cpufeatures@0.3.0
- crc32fast@1.5.0
- crossbeam-channel@0.5.15
- crossbeam-utils@0.8.21
- crypto-common@0.1.7
- deranged@0.5.8
- derive_arbitrary@1.4.2
- digest@0.10.7
- dirs@6.0.0
- dirs-sys@0.5.0
- displaydoc@0.2.6
- dtoa@1.0.11
- dyn-clone@1.0.20
- embed_plist@1.2.2
- enumflags2@0.7.12
- enumflags2_derive@0.7.12
- erased-serde@0.4.10
- errno@0.3.14
- fdeflate@0.3.7
- field-offset@0.3.6
- find-msvc-tools@0.1.9
- flate2@1.1.9
- form_urlencoded@1.2.2
- futures-channel@0.3.32
- futures-core@0.3.32
- futures-executor@0.3.32
- futures-io@0.3.32
- futures-macro@0.3.32
- futures-sink@0.3.32
- futures-task@0.3.32
- futures-util@0.3.32
- getrandom@0.2.17
- getrandom@0.3.4
- getrandom@0.4.3
- glob@0.3.3
- hashbrown@0.12.3
- hashbrown@0.17.1
- heck@0.4.1
- heck@0.5.0
- hermit-abi@0.5.2
- hex@0.4.3
- html5ever@0.38.0
- http@1.4.2
- httparse@1.10.1
- httpdate@1.0.3
- iana-time-zone@0.1.65
- iana-time-zone-haiku@0.1.2
- idna@1.1.0
- ipnet@2.12.0
- itoa@1.0.18
- jni@0.22.4
- jni-macros@0.22.4
- jni-sys@0.3.1
- jni-sys@0.4.1
- jni-sys-macros@0.4.1
- js-sys@0.3.102
- jsonptr@0.6.3
- keyboard-types@0.7.0
- lazy_static@1.5.0
- libc@0.2.186
- lock_api@0.4.14
- log@0.4.33
- markup5ever@0.38.0
- mime@0.3.17
- ndk@0.9.0
- ndk-sys@0.6.0+11769913
- num-conv@0.2.2
- num-traits@0.2.19
- once_cell@1.21.4
- openssl-probe@0.2.1
- ordered-stream@0.2.0
- osakit@0.3.1
- parking_lot@0.12.5
- parking_lot_core@0.9.12
- percent-encoding@2.3.2
- piper@0.2.5
- pkg-config@0.3.33
- png@0.17.16
- png@0.18.1
- powerfmt@0.2.0
- ppv-lite86@0.2.21
- proc-macro-crate@1.3.1
- proc-macro-crate@2.0.2
- proc-macro-crate@3.5.0
- proc-macro-error@1.0.4
- proc-macro-error-attr@1.0.4
- proc-macro2@1.0.106
- quinn@0.11.11
- quinn-proto@0.11.16
- quinn-udp@0.5.15
- quote@1.0.45
- rand@0.9.4
- rand@0.10.2
- rand_chacha@0.9.0
- rand_core@0.9.5
- rand_core@0.10.1
- rand_pcg@0.10.2
- ref-cast@1.0.25
- ref-cast-impl@1.0.25
- regex@1.12.4
- regex-automata@0.4.14
- regex-syntax@0.8.11
- reqwest@0.12.28
- reqwest@0.13.4
- rustc_version@0.4.1
- rustls-pki-types@1.15.0
- rustls-platform-verifier@0.7.0
- rustls-platform-verifier-android@0.1.1
- rustversion@1.0.22
- scopeguard@1.2.0
- security-framework@3.7.0
- security-framework-sys@2.17.0
- semver@1.0.28
- serde@1.0.228
- serde_core@1.0.228
- serde_derive@1.0.228
- serde_derive_internals@0.29.1
- serde_json@1.0.150
- serde_repr@0.1.20
- serde_spanned@0.6.9
- serde_spanned@1.1.1
- serde_with@3.21.0
- serde_with_macros@3.21.0
- serde-untagged@0.1.9
- serialize-to-javascript@0.1.2
- serialize-to-javascript-impl@0.1.2
- servo_arc@0.4.3
- sha2@0.10.9
- shlex@2.0.1
- signal-hook-registry@1.4.8
- simdutf8@0.1.5
- smallvec@1.15.2
- socket2@0.6.4
- softbuffer@0.4.8
- stable_deref_trait@1.2.1
- string_cache@0.9.0
- string_cache_codegen@0.6.1
- swift-rs@1.0.7
- syn@1.0.109
- syn@2.0.118
- system-deps@6.2.2
- tao-macros@0.1.3
- tar@0.4.46
- tempfile@3.27.0
- tendril@0.5.0
- thiserror@1.0.69
- thiserror@2.0.18
- thiserror-impl@1.0.69
- thiserror-impl@2.0.18
- time@0.3.49
- time-core@0.1.9
- time-macros@0.2.29
- tiny_http@0.12.0
- tokio-rustls@0.26.4
- toml@0.8.2
- toml@0.9.12+spec-1.1.0
- toml@1.1.2+spec-1.1.0
- toml_datetime@0.6.3
- toml_datetime@0.7.5+spec-1.1.0
- toml_datetime@1.1.1+spec-1.1.0
- toml_edit@0.19.15
- toml_edit@0.20.2
- toml_edit@0.25.12+spec-1.1.0
- toml_parser@1.1.2+spec-1.1.0
- toml_writer@1.1.1+spec-1.1.0
- tray-icon@0.24.1
- typeid@1.0.3
- typenum@1.20.1
- unicode-segmentation@1.13.3
- url@2.5.8
- utf-8@0.7.6
- wasm-bindgen@0.2.125
- wasm-bindgen-futures@0.4.75
- wasm-bindgen-macro@0.2.125
- wasm-bindgen-macro-support@0.2.125
- wasm-bindgen-shared@0.2.125
- wasm-streams@0.5.0
- web_atoms@0.2.5
- web-sys@0.3.102
- web-time@1.1.0
- windows@0.61.3
- windows_aarch64_gnullvm@0.42.2
- windows_aarch64_gnullvm@0.48.5
- windows_aarch64_gnullvm@0.52.6
- windows_aarch64_gnullvm@0.53.1
- windows_aarch64_msvc@0.42.2
- windows_aarch64_msvc@0.48.5
- windows_aarch64_msvc@0.52.6
- windows_aarch64_msvc@0.53.1
- windows_i686_gnu@0.42.2
- windows_i686_gnu@0.48.5
- windows_i686_gnu@0.52.6
- windows_i686_gnu@0.53.1
- windows_i686_gnullvm@0.52.6
- windows_i686_gnullvm@0.53.1
- windows_i686_msvc@0.42.2
- windows_i686_msvc@0.48.5
- windows_i686_msvc@0.52.6
- windows_i686_msvc@0.53.1
- windows_x86_64_gnu@0.42.2
- windows_x86_64_gnu@0.48.5
- windows_x86_64_gnu@0.52.6
- windows_x86_64_gnu@0.53.1
- windows_x86_64_gnullvm@0.42.2
- windows_x86_64_gnullvm@0.48.5
- windows_x86_64_gnullvm@0.52.6
- windows_x86_64_gnullvm@0.53.1
- windows_x86_64_msvc@0.42.2
- windows_x86_64_msvc@0.48.5
- windows_x86_64_msvc@0.52.6
- windows_x86_64_msvc@0.53.1
- windows-collections@0.2.0
- windows-core@0.61.2
- windows-core@0.62.2
- windows-future@0.2.1
- windows-implement@0.60.2
- windows-interface@0.59.3
- windows-link@0.1.3
- windows-link@0.2.1
- windows-numerics@0.2.0
- windows-result@0.3.4
- windows-result@0.4.1
- windows-strings@0.4.2
- windows-strings@0.5.1
- windows-sys@0.45.0
- windows-sys@0.48.0
- windows-sys@0.52.0
- windows-sys@0.59.0
- windows-sys@0.60.2
- windows-sys@0.61.2
- windows-targets@0.42.2
- windows-targets@0.48.5
- windows-targets@0.52.6
- windows-targets@0.53.5
- windows-threading@0.1.0
- windows-version@0.1.7
- xattr@1.6.1

### MIT OR Apache-2.0 OR LGPL-2.1-or-later

- r-efi@5.3.0
- r-efi@6.0.0

### MIT OR Apache-2.0 OR Zlib

- lru-slab@0.1.2
- raw-window-handle@0.6.2
- tinyvec_macros@0.1.1

### MIT OR Zlib OR Apache-2.0

- miniz_oxide@0.8.9

### MIT/Apache-2.0

- android_system_properties@0.1.5
- bitflags@1.3.2
- bs58@0.5.1
- downcast-rs@1.2.1
- filetime@0.2.29
- foreign-types@0.5.0
- foreign-types-macros@0.2.3
- foreign-types-shared@0.3.1
- ident_case@1.0.1
- jni@0.21.1
- json-patch@3.0.1
- pathdiff@0.2.3
- scoped-tls@1.0.1
- serde_urlencoded@0.7.1
- shell-words@1.1.1
- siphasher@1.0.3
- unic-char-property@0.9.0
- unic-char-range@0.9.0
- unic-common@0.9.0
- unic-ucd-ident@0.9.0
- unic-ucd-version@0.9.0
- version_check@0.9.5
- winapi@0.3.9
- winapi-i686-pc-windows-gnu@0.4.0
- winapi-x86_64-pc-windows-gnu@0.4.0

### MPL-2.0

- cssparser@0.36.0
- cssparser-macros@0.6.1
- dtoa-short@0.3.5
- option-ext@0.2.0
- selectors@0.36.1

### Unicode-3.0

- icu_collections@2.2.0
- icu_locale_core@2.2.0
- icu_normalizer@2.2.0
- icu_normalizer_data@2.2.0
- icu_properties@2.2.0
- icu_properties_data@2.2.0
- icu_provider@2.2.0
- litemap@0.8.2
- potential_utf@0.1.5
- tinystr@0.8.3
- writeable@0.6.3
- yoke@0.8.3
- yoke-derive@0.8.2
- zerofrom@0.1.8
- zerofrom-derive@0.1.7
- zerotrie@0.2.4
- zerovec@0.11.6
- zerovec-derive@0.11.3

### Unlicense OR MIT

- aho-corasick@1.1.4
- byteorder@1.5.0
- memchr@2.8.2
- winapi-util@0.1.11

### Unlicense/MIT

- same-file@1.0.6
- walkdir@2.5.0

### Zlib

- foldhash@0.2.0

### Zlib OR Apache-2.0 OR MIT

- bytemuck@1.25.0
- dispatch2@0.3.1
- objc2-app-kit@0.3.2
- objc2-cloud-kit@0.3.2
- objc2-core-data@0.3.2
- objc2-core-foundation@0.3.2
- objc2-core-graphics@0.3.2
- objc2-core-image@0.3.2
- objc2-core-location@0.3.2
- objc2-core-text@0.3.2
- objc2-exception-helper@0.1.1
- objc2-io-surface@0.3.2
- objc2-osa-kit@0.3.2
- objc2-quartz-core@0.3.2
- objc2-ui-kit@0.3.2
- objc2-user-notifications@0.3.2
- objc2-web-kit@0.3.2
- tinyvec@1.11.0
