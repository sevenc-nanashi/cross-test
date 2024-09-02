/**
 * This test uses `@cross/fs`, a file system abstraction that works on both Deno and Node-like runtimes.
 */

import { createCrossTest } from "../mod.ts";
import { readFile } from "jsr:@cross/fs/io";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun"],
});

crossTest("@cross/fs works on server-side js runtimes", async () => {
  await readFile("./README.md");
});
