import { crossTestRegistrar } from "./runtimes/runner.ts";
import * as host from "./host.deno.ts";

export type Runtime = "node" | "browser" | "deno" | "workerd" | "bun";
export type TestOptions = {
  runtimes: Runtime[];
};

export type CrossTestRegistrar = {
  (name: string, fn: Deno.TestDefinition["fn"]): void;
  (
    name: string,
    testOptions: Omit<Deno.TestDefinition, "name" | "fn" | "sanitizeOps">,
    fn: Deno.TestStepDefinition["fn"],
  ): void;
};

const calledFrom = new Set<string>();
export const createCrossTest = async (
  file: string,
  options: TestOptions,
): Promise<CrossTestRegistrar> => {
  if (calledFrom.has(file)) {
    throw new Error("createCrossTest must be called only once per file");
  }
  calledFrom.add(file);

  if (typeof Deno !== "undefined" && Deno.version) {
    const key = "crossTestHost" as string;
    // @ts-expect-error Some hack to remove esbuild warning
    return await host[key]({
      file,
      options,
    });
  }

  return crossTestRegistrar() as CrossTestRegistrar;
};
