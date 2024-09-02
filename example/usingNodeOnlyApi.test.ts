/**
 * @module
 *
 * Of course, `node:` apis are not available in Browser.
 * This test is expected to fail in Browser.
 */

import { createCrossTest } from "../mod.ts";
import { assertEquals } from "jsr:@std/assert";
import { shouldRun } from "./shouldRun.ts";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun", "browser"],
});

crossTest(
  "Failing: Using node:fs/promises",
  {
    ignore: !shouldRun,
  },
  async () => {
    const { readFile } = await import("node:fs/promises");
    const readme = await readFile("./README.md", "utf-8");
    assertEquals(typeof readme, "string");
  },
);
