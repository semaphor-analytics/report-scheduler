import { access, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const sampleDir = fileURLToPath(
  new URL("../out/report-document-samples", import.meta.url),
);
const screenshotDir = join(sampleDir, "screenshots");
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await access(chromePath).catch(() => {
  throw new Error(
    `Chrome was not found at ${chromePath}. Set CHROME_PATH to a Chrome or Chromium executable.`,
  );
});

await mkdir(screenshotDir, { recursive: true });

const sampleFiles = (await readdir(sampleDir))
  .filter((filename) => filename.endsWith(".html"))
  .sort();

if (sampleFiles.length === 0) {
  throw new Error(
    `No HTML samples found in ${sampleDir}. Run npm run report-doc:samples first.`,
  );
}

for (const sampleFile of sampleFiles) {
  const inputPath = resolve(sampleDir, sampleFile);
  const outputPath = join(screenshotDir, `${sampleFile.slice(0, -5)}.png`);
  await screenshotHtml(inputPath, outputPath);
  console.log(`Rendered ${outputPath}`);
}

async function screenshotHtml(inputPath: string, outputPath: string): Promise<void> {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1200,1600",
    `--screenshot=${outputPath}`,
    pathToFileURL(inputPath).href,
  ];

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(chromePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `Chrome screenshot failed for ${inputPath} with exit code ${code}.\n${stderr}`,
        ),
      );
    });
  });
}
