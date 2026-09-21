// Single import point for document validation and bundle helpers.
//
// TODO(sdk): once `@quireos/sdk` (cloudflare/sdk) builds, replace the line below with
//     export * from "@quireos/sdk";
// add `"@quireos/sdk": "*"` to package.json dependencies, and delete src/validate_stub.ts.
// The stub mirrors the SDK names, signatures and semantics the store relies on:
//   validateBundle(files: Map<string, Uint8Array>) => { ok, errors: {path, message}[] }
//   validateManifest(doc), validateIndex(doc), validateScreen(doc)
//   bundleMount(manifest) => "" | "/mount" | undefined
//   rebaseBundle(files, fromMount, toMount) => Map<string, Uint8Array>
//   classifyUrl(url)
//   types Manifest, StoreIndex, StoreMeta
export * from "./validate_stub";
