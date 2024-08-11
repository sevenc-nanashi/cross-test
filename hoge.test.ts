import { crossTest } from "./crossTest.ts";
import { assertEquals } from "@std/assert";

const test = crossTest(import.meta.url, { platforms: ["deno", "node", "bun"] });

Deno.test(
  "hoge",
  test((t) => {
    assertEquals(1, 1);
  }),
);

Deno.test(
  "fuga",
  test((t) => {
    assertEquals(1, 1);
  }),
);
