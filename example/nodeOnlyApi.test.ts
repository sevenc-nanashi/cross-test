/**
 * @module
 */

import { getEnv } from "@cross/env";
import { createCrossTest } from "../crossTest.ts";
import { assert } from "jsr:@std/assert";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun", "workerd"],
});

Deno.test(
  "Failing: Use node only API",
  {
    ignore: !!getEnv("CROSSTEST_RUN_FAILING_TESTS"),
  },
  crossTest(async () => {
    assert(location);
  }),
);
