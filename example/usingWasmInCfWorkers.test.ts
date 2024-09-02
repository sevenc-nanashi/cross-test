/**
 * @module
 *
 * Cloudflare Workers restricts most of the WebAssembly APIs.
 * So this test is expected to fail in Cloudflare Workers.
 */

import { createCrossTest } from "../mod.ts";
import { assertEquals } from "jsr:@std/assert";
import { shouldRun } from "./shouldRun.ts";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun", "workerd", "browser"],
});

// https://developer.mozilla.org/en-US/docs/WebAssembly/Understanding_the_text_format#the_simplest_module
// 0000000: 0061 736d              ; WASM_BINARY_MAGIC
// 0000004: 0100 0000              ; WASM_BINARY_VERSION
const minimumWasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

crossTest(
  "Failing: Using WebAssembly",
  {
    ignore: !shouldRun,
  },
  async () => {
    const wasm = await WebAssembly.instantiate(minimumWasm);
    assertEquals(typeof wasm, "object");
  },
);
