import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getEnvFileArg, loadEnv } from "../../src/config/loadEnv.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.INSIGHT_LOOP_TEST_ENV_VALUE;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("loadEnv", () => {
  it("loads .env.local and lets explicit env files override local values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-env-"));
    tempDirs.push(dir);
    await writeFile(join(dir, ".env.local"), "INSIGHT_LOOP_TEST_ENV_VALUE=local\n");
    await writeFile(join(dir, "custom.env"), "INSIGHT_LOOP_TEST_ENV_VALUE=custom\n");

    loadEnv({ cwd: dir, envFile: "custom.env" });

    expect(process.env.INSIGHT_LOOP_TEST_ENV_VALUE).toBe("custom");
  });

  it("parses --env-file arguments", () => {
    expect(getEnvFileArg(["run", "example.md", "--env-file", "local.env"])).toBe(
      "local.env",
    );
    expect(getEnvFileArg(["run", "example.md", "--env-file=local.env"])).toBe(
      "local.env",
    );
  });
});
