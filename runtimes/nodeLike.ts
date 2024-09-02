import { Lock } from "@core/asyncutil/lock";
import type { Runtime } from "../crossTest.ts";
import {
  basePrepareJs,
  type InitialParentData,
  RunnerController,
} from "./base.ts";
import { isDebug } from "../debug.ts";
import { prelude } from "./runner.ts";

const prepareJs = async (file: string) => {
  const preludeCode = `const __crosstestPrelude = (${prelude.toString()})()`;
  const outroCode =
    `__crosstestPrelude.outro(JSON.parse(process.env.CROSSTEST_PARENT_DATA))`;

  return await basePrepareJs(file, "nodeLike", {
    prelude: preludeCode,
    outro: outroCode,
  });
};

export class NodeLikeRunnerController extends RunnerController {
  runtime: "node" | "bun";
  child: Deno.ChildProcess;
  args: string[];
  isDead = false;

  sendLock = new Lock(undefined);

  static async create(file: string, runtime: Runtime) {
    let commandArgs: string[];
    const path = await prepareJs(file);
    if (runtime === "bun") {
      commandArgs = ["bun", "run", path];
    } else if (runtime === "node") {
      commandArgs = ["node", "--enable-source-maps", path];
    } else {
      throw new Error(`Unsupported runtime: ${runtime}`);
    }

    return new NodeLikeRunnerController(file, commandArgs, runtime);
  }

  constructor(file: string, args: string[], runtime: "node" | "bun") {
    super(runtime);
    this.runtime = runtime;

    this.args = args;

    const command = new Deno.Command(args[0], {
      args: args.slice(1),
      env: {
        CROSSTEST_PARENT_DATA: JSON.stringify(
          {
            file,
            runtime,
            server: `http://localhost:${this.server.addr.port}`,
            isDebug: isDebug(),
          } satisfies InitialParentData,
        ),
      },
      stdin: "null",
    });

    this.child = command.spawn();

    void this.child.status.then(() => {
      this.isDead = true;
      this.panic(new Error("Child process died"));
    });
  }

  async cleanup(e: Error | undefined) {
    super.cleanup(e);
    await this.child.status;

    if (e) {
      throw e;
    }
  }
}
