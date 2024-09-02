/**
 * This test checks import.meta is replaced
 */

import { fromFileUrl } from "jsr:@std/path@^1.0.2/from-file-url";
import { createCrossTest } from "../mod.ts";
import { assert } from "jsr:@std/assert";
import { readdir, readFile } from "jsr:@cross/fs@^0.1.11";

const crossTest = await createCrossTest(import.meta.url, {
  runtimes: ["deno", "node", "bun"],
});

crossTest("import.meta.url is replaced", () => {
  assert(import.meta.url.endsWith("importMeta.test.ts"));
});

crossTest("import.meta.filename is replaced", () => {
  const currentFile = fromFileUrl(import.meta.url);
  assert(import.meta.filename === currentFile);
});
crossTest("import.meta.filename is usable", async () => {
  await readFile(import.meta.filename!);
});

crossTest("import.meta.dirname is replaced", () => {
  const currentFile = fromFileUrl(import.meta.url);
  assert(currentFile.startsWith(import.meta.dirname!));
});
crossTest("import.meta.dirname is usable", async () => {
  await readdir(import.meta.dirname!);
});
