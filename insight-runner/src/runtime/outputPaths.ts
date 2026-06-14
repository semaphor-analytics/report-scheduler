import { basename, extname, join } from "node:path";

export interface ResolveRunOutputPathInput {
  definitionPath: string;
  requestedOutputPath?: string;
  now?: Date;
}

export function resolveRunOutputPath(input: ResolveRunOutputPathInput): string {
  if (input.requestedOutputPath && extname(input.requestedOutputPath)) {
    return input.requestedOutputPath;
  }

  const outputDirectory = input.requestedOutputPath || "runs";
  const timestamp = formatFilenameTimestamp(input.now ?? new Date());
  const slug = slugifyFilename(basename(input.definitionPath, extname(input.definitionPath)));
  return join(outputDirectory, `${timestamp}-${slug || "insight-loop"}.md`);
}

function formatFilenameTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function slugifyFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
