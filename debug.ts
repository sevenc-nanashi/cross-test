export const isDebug = () => {
  if (
    Deno.permissions.querySync({
      name: "env",
      variable: "DEBUG",
    }).state === "granted"
  ) {
    const debug = Deno.env.get("DEBUG");
    return !!debug;
  }
  return false;
};

export const debug = (...args: unknown[]) => {
  if (!isDebug()) {
    return;
  }
  console.warn(`[crosstest debug]`, ...args);
};
