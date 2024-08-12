/**
 * @module
 */

import { createCrossTest } from "../crossTest.ts";
import { assert, assertEquals } from "jsr:@std/assert";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "browser"],
});

Deno.test(
  "Use node only API",
  crossTest(async () => {
    assert(location)
  }),
);
