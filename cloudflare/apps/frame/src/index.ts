/**
 * Frame entry point for Workers: imports the WASM modules and the Roboto fonts as modules
 * (wrangler: *.wasm → CompiledWasm, *.ttf → Data via `rules`) and initialises the renderer once
 * at module scope, as the SDK README prescribes.
 */
import yoga from "satori/yoga.wasm";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import regular from "../../../../firmware/fonts/Roboto-Regular.ttf";
import bold from "../../../../firmware/fonts/Roboto-Bold.ttf";
import { createFrameApp } from "./app.js";
import { makeRenderer } from "./render.js";

export { manifest } from "./manifest.js";

const renderer = makeRenderer({ yoga, resvg, fonts: { regular, bold } });

export default createFrameApp(renderer);
