/**
 * @module
 *
 * `fast-base64` uses `WebAssembly.instantiate` (with buffer) which is not available in Cloudflare Workers.
 * So this test is expected to fail in Cloudflare Workers.
 */

import { createCrossTest } from "../crossTest.ts";
import { assertEquals } from "jsr:@std/assert";
import { toBase64 } from "npm:fast-base64@^0.1.8";

const crossTest = createCrossTest(import.meta.url, {
  platforms: ["deno", "node", "bun", "cfWorkers"],
});

Deno.test(
  "Use toBase64",
  crossTest(async () => {
    const encoded = new TextEncoder().encode("Hello, World!");
    assertEquals(await toBase64(encoded), "SGVsbG8sIFdvcmxkIQ==");
  }),
);
