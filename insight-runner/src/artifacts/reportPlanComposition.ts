import type { ReportBlock, ReportPlan } from "./reportBlocks.js";

export interface ReportPlanComposition {
  title?: string;
  sections: Array<{
    blockId: string;
    title?: string;
    rationale?: string;
  }>;
}

export function applyReportPlanComposition(input: {
  basePlan: ReportPlan;
  composition?: ReportPlanComposition;
}): ReportPlan {
  const composition = input.composition;
  if (!composition || composition.sections.length === 0) {
    return {
      ...input.basePlan,
      blocks: applyKpiFirstPolicy(input.basePlan.blocks),
    };
  }

  const blockById = new Map(input.basePlan.blocks.map((block) => [block.id, block]));
  const selected = new Set<string>();
  const blocks: ReportBlock[] = [];

  for (const section of composition.sections) {
    const block = blockById.get(section.blockId);
    if (!block || selected.has(block.id) || isAppendixBlock(block)) {
      continue;
    }

    selected.add(block.id);
    blocks.push(applyTitleOverride(block, section.title));
  }

  for (const block of input.basePlan.blocks) {
    if (!selected.has(block.id) && !isAppendixBlock(block)) {
      blocks.push(block);
    }
  }

  for (const block of input.basePlan.blocks) {
    if (isAppendixBlock(block)) {
      blocks.push(block);
    }
  }

  return {
    title: composition.title?.trim() || input.basePlan.title,
    blocks: applyKpiFirstPolicy(blocks),
  };
}

function isAppendixBlock(block: ReportBlock): boolean {
  return (
    block.type === "evidence" ||
    block.type === "query_summary" ||
    block.type === "sql"
  );
}

function applyTitleOverride(
  block: ReportBlock,
  title: string | undefined,
): ReportBlock {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle || !("title" in block)) {
    return block;
  }

  return {
    ...block,
    title: normalizedTitle,
  } as ReportBlock;
}

function applyKpiFirstPolicy(blocks: ReportBlock[]): ReportBlock[] {
  const appendixBlocks = blocks.filter(isAppendixBlock);
  const businessBlocks = blocks.filter((block) => !isAppendixBlock(block));
  const metricBlocks = businessBlocks.filter((block) => block.type === "metric");

  if (metricBlocks.length === 0) {
    return blocks;
  }

  const remainingBlocks = businessBlocks.filter((block) => block.type !== "metric");
  return [...metricBlocks, ...remainingBlocks, ...appendixBlocks];
}
