/**
 * @module
 *
 * `fast-base64` uses `WebAssembly.instantiate` (with buffer) which is not available in Cloudflare Workers.
 * So this test is expected to fail in Cloudflare Workers.
 */

import { getEnv } from "@cross/env";
import { createCrossTest } from "../mod.ts";
import { assertEquals } from "jsr:@std/assert";
import { toBase64 } from "npm:fast-base64@^0.1.8";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun", "workerd"],
});

Deno.test(
  "Failing: Use toBase64",
  {
    ignore: !!getEnv("CROSSTEST_RUN_FAILING_TESTS"),
  },
  crossTest(async () => {
    const encoded = new TextEncoder().encode("Hello, World!");
    assertEquals(await toBase64(encoded), "SGVsbG8sIFdvcmxkIQ==");
  }),
);
