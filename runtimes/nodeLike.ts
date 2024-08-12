import { join } from "@std/path";
import { Lock } from "@core/asyncutil/lock";
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { SourceMapGenerator, SourceMapConsumer } from "source-map";
import type { Runtime } from "../crossTest.ts";
import { createDistRoot, findDenoJson, RunnerController } from "./base.ts";
import { debug, isDebug } from "../debug.ts";
import { prelude } from "./runner.ts";

export type ParentData = {
  runtime: Runtime;
  file: string;
  server: string;
  isDebug: boolean;
};

const hash = async (data: string) => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const cache = new Lock(new Map<string, string>());

const prepareJs = async (file: string) =>
  await cache.lock(async (map) => {
    const cached = map.get(file);
    if (cached) {
      debug(`Cache hit: ${file} -> ${cached}`);
      return cached;
    }
    debug(`Cache miss: ${file}`);
    const denoJsonPath = await findDenoJson(file);
    const distRoot = await createDistRoot();
    const outfile = join(distRoot, `${await hash(file)}-node.mjs`);
    debug(`deno.json/deno.jsonc path: ${denoJsonPath}`);
    const preludeCode = await esbuild.transform(
      [
        `const __anytestPrelude = (${prelude.toString()})()`,
        "const Deno = { test: __anytestPrelude.prepareDenoTest() }",
      ].join(";"),
      {
        minify: !isDebug(),
      },
    );
    const outroCode = `__anytestPrelude.outro(JSON.parse(process.env.CROSSTEST_PARENT_DATA))`;
    await esbuild.build({
      entryPoints: [file],
      format: "esm",
      bundle: true,
      sourcemap: true,
      minify: !isDebug(),
      outfile,
      banner: {
        js: preludeCode.code,
      },
      footer: {
        js: outroCode,
      },
      plugins: [
        {
          name: "clearDenoTs",
          setup(build) {
            build.onLoad({ filter: /\.deno\.ts$/ }, () => {
              return {
                contents: "export {}",
                loader: "ts",
              };
            });
          },
        },
        ...denoPlugins({
          configPath: denoJsonPath,
        }),
      ],
    });
    await esbuild.stop();
    debug(`Prepared: ${file} -> ${outfile}`);

    const mapPath = `${outfile}.map`;
    const mapData = SourceMapGenerator.fromSourceMap(
      await new SourceMapConsumer(JSON.parse(await Deno.readTextFile(mapPath))),
    );
    for (let line = 0; line < preludeCode.code.split("\n").length; line++) {
      mapData.addMapping({
        source: "cross-test:prelude",
        generated: { line: line + 1, column: 0 },
        original: { line: 1, column: 0 },
      });
    }
    const finalLines = await Deno.readTextFile(outfile);
    const finalLinesCount = finalLines.split("\n").length;
    for (let line = 0; line < outroCode.split("\n").length; line++) {
      mapData.addMapping({
        source: "cross-test:outro",
        generated: { line: finalLinesCount - outroCode.split("\n").length + line, column: 0 },
        original: { line: 1, column: 0 },
      });
    }
    mapData.setSourceContent("cross-test:prelude", "// Not available");
    mapData.setSourceContent("cross-test:outro", "// Not available");

    await Deno.writeTextFile(mapPath, mapData.toString());

    return outfile;
  });

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
        CROSSTEST_PARENT_DATA: JSON.stringify({
          file,
          runtime,
          server: `http://localhost:${this.server.addr.port}`,
          isDebug: isDebug(),
        } satisfies ParentData),
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
    this.server.shutdown();
    await this.send({ type: "exit" });
    this.child.kill();
    await this.child.status;

    if (e) {
      throw e;
    }
  }
}
