import { CurrentRuntime, Runtime } from "@cross/runtime";
import { crossTest } from "./crossTest.ts";
import { assertEquals } from "@std/assert";

const test = crossTest(import.meta.url, {
  platforms: ["deno", "node", "bun", "cfWorkers"],
});

Deno.test(
  "hoge",
  test(async (t) => {
    await t.step({
      name: "deno only",
      ignore: CurrentRuntime !== Runtime.Deno,
      fn: () => {
        assertEquals(1, 1);
      },
    });
    await t.step({
      name: "node only",
      ignore: CurrentRuntime !== Runtime.Node,
      fn: () => {
        assertEquals(1, 1);
      },
    });
    await t.step({
      name: "bun only",
      ignore: CurrentRuntime !== Runtime.Bun,
      fn: () => {
        assertEquals(1, 1);
      },
    });
    await t.step({
      name: "workerd only",
      ignore: CurrentRuntime !== Runtime.Workerd,
      fn: () => {
        assertEquals(1, 1);
      },
    });
  }),
);
