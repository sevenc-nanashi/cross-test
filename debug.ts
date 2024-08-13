const getEnv = (name: string): string | undefined => {
  if (
    Deno.permissions.querySync({
      name: "env",
      variable: name,
    }).state === "granted"
  ) {
    return Deno.env.get(name);
  }
  return undefined;
};

export const isDebug = () => {
  return getEnv("CROSSTEST_DEBUG") === "1";
};

export const debug = (...args: unknown[]) => {
  if (!isDebug()) {
    return;
  }
  const formatted = `[crosstest debug] ${args.join(" ")}`;
  const maxLength = parseInt(getEnv("CROSSTEST_DEBUG_MAX_LENGTH") ?? "256");
  if (formatted.length > maxLength) {
    console.log(formatted.slice(0, maxLength) + "...");
  }
  console.log(formatted);
};
