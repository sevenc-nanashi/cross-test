export const shouldRun =
  typeof Deno !== "undefined" && Deno.env
    ? !!Deno.env.get("CROSSTEST_RUN_FAILING_TESTS")
    : false;
