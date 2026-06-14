import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const ENV_FILES = [".env", ".env.local"];

export interface LoadEnvOptions {
  cwd?: string;
  envFile?: string;
}

export function loadEnv(options: LoadEnvOptions | string = {}): void {
  const cwd = typeof options === "string" ? options : options.cwd ?? process.cwd();
  const files = [
    ...ENV_FILES,
    ...(typeof options === "string" || !options.envFile ? [] : [options.envFile]),
  ];

  for (const file of files) {
    const path = resolve(cwd, file);
    if (existsSync(path)) {
      config({
        path,
        override: typeof options !== "string" && file === options.envFile,
        quiet: true,
      });
    }
  }
}

export function getEnvFileArg(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      return argv[index + 1];
    }
    if (arg?.startsWith("--env-file=")) {
      return arg.slice("--env-file=".length);
    }
  }
  return undefined;
}
