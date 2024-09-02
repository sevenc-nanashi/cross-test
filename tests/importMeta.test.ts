/**
 * This test checks import.meta is replaced
 */

import { fromFileUrl } from "jsr:@std/path@^1.0.2/from-file-url";
import { createCrossTest } from "../mod.ts";
import { assert } from "jsr:@std/assert";

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

crossTest("import.meta.dirname is replaced", () => {
  const currentFile = fromFileUrl(import.meta.url);
  assert(currentFile.startsWith(import.meta.dirname!));
});
