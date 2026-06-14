import { readFile } from "node:fs/promises";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { InsightLoopDefinition } from "./types.js";

type MdastNode = {
  type: string;
  depth?: number;
  children?: MdastNode[];
};

export async function parseInsightLoopMarkdownFile(
  definitionPath: string,
): Promise<InsightLoopDefinition> {
  const rawMarkdown = await readFile(definitionPath, "utf8");
  return parseInsightLoopMarkdown(rawMarkdown, definitionPath);
}

export function parseInsightLoopMarkdown(
  rawMarkdown: string,
  sourcePath = "<memory>",
): InsightLoopDefinition {
  const root = fromMarkdown(rawMarkdown) as MdastNode;
  const title = findTitle(root) ?? "Untitled Insight Loop";
  const freeformText = normalizeWhitespace(toString(root));

  return {
    title,
    sourcePath,
    rawMarkdown,
    freeformText,
    sections: [],
    questions: [],
    guardrails: [],
  };
}

function findTitle(root: MdastNode): string | undefined {
  const heading = root.children?.find(
    (node) => node.type === "heading" && node.depth === 1,
  );
  const text = heading ? normalizeWhitespace(toString(heading)) : "";
  return text || undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
