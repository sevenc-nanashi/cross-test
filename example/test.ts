import { createCrossTest } from "../mod.ts";
import { readFile } from "jsr:@cross/fs/io";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "browser"],
});

crossTest("a", {}, async () => {
  const data = await readFile("./README.md");

  /* ... */
});
