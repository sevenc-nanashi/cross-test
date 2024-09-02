/**
 * This test uses `TextDecoder` can decode UTF-8 in 5 runtimes.
 */

import { createCrossTest } from "../mod.ts";
import { assertEquals } from "jsr:@std/assert";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun", "workerd", "browser"],
});

crossTest("TextDecoder can decode utf-8 string", () => {
  const bytes = [230, 151, 165, 230, 156, 172, 232, 170, 158];
  const decoder = new TextDecoder("utf-8");
  const data = decoder.decode(Uint8Array.from(bytes));
  assertEquals(data, "日本語");
});
