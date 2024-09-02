export type CrossTestRegistrarArgs =
  | [name: string, fn: Deno.TestDefinition["fn"]]
  | [
    name: string,
    options: Omit<Deno.TestDefinition, "name" | "fn" | "sanitizeOps">,
    fn: Deno.TestStepDefinition["fn"],
  ];
