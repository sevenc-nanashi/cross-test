/**
 * @module
 *
 * Bun's TextDecoder cannot decode `shift_jis` encoding.
 * ref: https://github.com/oven-sh/bun/issues/11564
 *
 * This test is expected to fail in Bun.
 * TODO: Find better example in case the issue is fixed.
 */

import { createCrossTest } from "../crossTest.ts";
import { assertEquals } from "jsr:@std/assert";

const crossTest = createCrossTest(import.meta.url, {
  platforms: ["deno", "node", "bun", "cfWorkers"],
});

Deno.test(
  "Use textDecoder",
  crossTest(() => {
    const bytes = [147, 250, 150, 123, 140, 234];

    const decoder = new TextDecoder("shift_jis");
    const data = decoder.decode(Uint8Array.from(bytes));
    assertEquals(data, "日本語");
  }),
);