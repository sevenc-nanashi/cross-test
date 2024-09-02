// @cross/env doesn't work in the browser so we need to use Deno.env instead.
export const shouldRun = typeof Deno !== "undefined" && Deno.env
  ? !!Deno.env.get("CROSSTEST_RUN_FAILING_TESTS")
  : false;
