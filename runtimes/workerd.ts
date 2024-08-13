import { basePrepareJs, RunnerController } from "./base.ts";
import { TextLineStream } from "@std/streams";
import dir from "dir/mod.ts";
import { prelude } from "./runner.ts";
import { debug, isDebug } from "../debug.ts";
import type {
  FromMfManagerMessage,
  ToMfManagerMessage,
} from "./workerdManager.node.ts";
import type { InitialParentData } from "./base.ts";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { Lock } from "@core/asyncutil/lock";
import { AsyncValue } from "@core/asyncutil/async-value";

const prepareJs = async (file: string) => {
  const preludeCode = [
    `const __crosstestPrelude = (${prelude.toString()})()`,
    "const Deno = { test: __crosstestPrelude.prepareDenoTest() }",
  ].join("\n");
  const outroCode = [
    `export default { async fetch(__crosstestRequest) {`,
    `await __crosstestPrelude.outro(await __crosstestRequest.json())`,
    `}}`,
  ].join("\n");

  return await basePrepareJs(file, "workerd", {
    prelude: preludeCode,
    outro: outroCode,
  });
};

export class WorkerdRunnerController extends RunnerController {
  workerd: Workerd;

  static async create(file: string) {
    const path = await prepareJs(file);
    const script = await Deno.readTextFile(path);
    const workerd = await Workerd.create(script);

    return new WorkerdRunnerController(file, workerd);
  }

  constructor(file: string, workerd: Workerd) {
    super("workerd");

    this.workerd = workerd;
    workerd.start({
      file: file,
      isDebug: isDebug(),
      runtime: "workerd",
      server: `http://localhost:${this.server.addr.port}`,
    });
  }

  async cleanup(e: Error | undefined): Promise<void> {
    super.cleanup(e);
    await this.workerd.kill();
  }
}

const workerdManager: Lock<AsyncValue<Deno.ChildProcess | undefined>> =
  new Lock(new AsyncValue(undefined));

const workerdManagerMesasgePromises = new Map<
  string,
  { resolve: (data: FromMfManagerMessage) => void; reject: (e: Error) => void }
>();

const workerdPath = new URL("./workerdManager.node.ts", import.meta.url)
  .pathname;

// Bump when the workerd manager must be recreated (for big changes)
const workerdManagerVersion = 1;
const setupWorkerdManager = async (path: string) => {
  debug(`Setting up workerd manager in ${path}`);
  await Deno.mkdir(path, { recursive: true });
  await Deno.writeTextFile(
    join(path, "workerdManager.ts"),
    await Deno.readTextFile(workerdPath),
  );
  await Deno.writeTextFile(
    join(path, "package.json"),
    JSON.stringify({
      name: "workerd-manager",
      type: "module",
      version: "0.0.0",
      workerdManagerVersion,
      lastUpdate: Date.now(),
      scripts: {
        start: "tsx workerdManager.ts",
      },
      dependencies: {
        miniflare: "3",
        tsx: "4.17.0",
        "get-port-please": "3.1.2",
      },
    }),
  );
  debug(`Installing workerd manager in ${path}`);
  await new Deno.Command("npm", {
    args: ["install"],
    cwd: path,
    stdout: "null",
  }).spawn().status;
};
const updateWorkerdManager = async (path: string) => {
  debug(`Updating workerd manager in ${path}`);
  await new Deno.Command("npm", {
    args: ["update"],
    cwd: path,
  }).spawn().status;
};

const getWorkerdManager = async () =>
  await workerdManager.lock(async (manager): Promise<Deno.ChildProcess> => {
    if (await manager.get()) {
      return (await manager.get())!;
    }

    const workerdManagerDir = join(
      dir("cache")!,
      "cross-test",
      "workerd-manager",
      "latest",
    );
    if (!(await exists(workerdManagerDir, { isDirectory: true }))) {
      debug(`Creating workerd manager in ${workerdManagerDir}`);
      await setupWorkerdManager(workerdManagerDir);
    } else {
      const packageJson = join(workerdManagerDir, "package.json");
      const { workerdManagerVersion: cachedManagerVersion, lastUpdate } =
        JSON.parse(await Deno.readTextFile(packageJson));
      if (cachedManagerVersion !== workerdManagerVersion) {
        await setupWorkerdManager(workerdManagerDir);
      } else if (Date.now() - lastUpdate > 1000 * 60 * 60 * 24) {
        await updateWorkerdManager(workerdManagerDir);
      } else {
        debug(`Using cached workerd manager in ${workerdManagerDir}`);
      }
    }

    await Deno.writeTextFile(
      join(workerdManagerDir, "workerdManager.ts"),
      await Deno.readTextFile(workerdPath),
    );

    const command = new Deno.Command("npm", {
      args: ["run", "start"],
      cwd: workerdManagerDir,
      stdin: "piped",
      stdout: "piped",
    });
    const workerdManagerProcess = command.spawn();
    workerdManagerProcess.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeTo(
        new WritableStream({
          write: (line) => {
            if (!line.startsWith("!")) {
              return;
            }
            const data = JSON.parse(line.slice(1));
            const promise = workerdManagerMesasgePromises.get(data.nonce);
            if (!promise) {
              throw new Error(`Invalid nonce: ${data.nonce}`);
            }
            workerdManagerMesasgePromises.delete(data.nonce);
            promise.resolve(data);
          },
        }),
      );
    workerdManagerProcess.status.then(() => {
      for (const { reject } of workerdManagerMesasgePromises.values()) {
        reject(new Error("Workerd manager died"));
      }
    });

    globalThis.addEventListener("unload", async () => {
      debug("Cleaning up workerd manager");
      await sendToWorkerdManager({ type: "exit" });
      await workerdManagerProcess.status;
    });

    await manager.set(workerdManagerProcess);

    return workerdManagerProcess;
  });

const workerdManagerStdin = new Lock(undefined);
const sendToWorkerdManager = async <M extends ToMfManagerMessage>(
  data: M,
): Promise<FromMfManagerMessage & { type: M["type"] }> => {
  return await workerdManagerStdin.lock(async () => {
    const nonce = crypto.randomUUID();
    const manager = await getWorkerdManager();
    const writer = manager.stdin.getWriter();
    const payload = {
      nonce,
      data,
    };
    const { promise, resolve, reject } = Promise.withResolvers<
      FromMfManagerMessage & { type: M["type"] }
    >();
    workerdManagerMesasgePromises.set(nonce, { resolve, reject });
    debug(`Sending to workerdManager: ${JSON.stringify(payload)}`);
    const buffer = new TextEncoder().encode(JSON.stringify(payload) + "\n");
    await writer.write(buffer);
    await writer.ready;
    writer.releaseLock();
    return promise;
  });
};

class Workerd {
  id: string;

  static async create(script: string) {
    const result = await sendToWorkerdManager({ type: "new", script });
    return new Workerd(result.id);
  }

  constructor(id: string) {
    this.id = id;
  }

  start(initialParentData: InitialParentData) {
    return sendToWorkerdManager({
      type: "start",
      id: this.id,
      initialParentData,
    });
  }

  async kill(): Promise<void> {
    await sendToWorkerdManager({ type: "kill", id: this.id });
  }
}
