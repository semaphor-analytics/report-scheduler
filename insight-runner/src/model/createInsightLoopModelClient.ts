import { FakeInsightLoopModelClient } from "./fakeInsightLoopModelClient.js";
import type { InsightLoopModelClient } from "./insightLoopModelClient.js";
import { OpenAiInsightLoopModelClient } from "./openAiInsightLoopModelClient.js";

export type InsightLoopModelProvider = "fake" | "openai";
export type InsightLoopReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const DEFAULT_INSIGHT_LOOP_MODEL = "gpt-5.5";
export const DEFAULT_INSIGHT_LOOP_REASONING_EFFORT: InsightLoopReasoningEffort =
  "medium";

export interface CreateInsightLoopModelClientOptions {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  requestTimeoutMs?: number;
}

export function createInsightLoopModelClient(
  options: CreateInsightLoopModelClientOptions = {},
): InsightLoopModelClient {
  const provider = normalizeProvider(
    options.provider ?? process.env.INSIGHT_LOOP_MODEL_PROVIDER ?? "fake",
  );

  if (provider === "fake") {
    return new FakeInsightLoopModelClient();
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is required when INSIGHT_LOOP_MODEL_PROVIDER=openai or --provider openai.",
    );
  }

  return new OpenAiInsightLoopModelClient({
    model:
      options.model ?? process.env.INSIGHT_LOOP_MODEL ?? DEFAULT_INSIGHT_LOOP_MODEL,
    reasoningEffort: normalizeReasoningEffort(
      options.reasoningEffort ??
        process.env.INSIGHT_LOOP_REASONING_EFFORT ??
        DEFAULT_INSIGHT_LOOP_REASONING_EFFORT,
    ),
    requestTimeoutMs: options.requestTimeoutMs,
  });
}

function normalizeProvider(provider: string): InsightLoopModelProvider {
  if (provider === "fake" || provider === "openai") {
    return provider;
  }

  throw new Error(
    `Unsupported model provider "${provider}". Expected "fake" or "openai".`,
  );
}

export function normalizeReasoningEffort(
  reasoningEffort: string,
): InsightLoopReasoningEffort {
  if (
    reasoningEffort === "none" ||
    reasoningEffort === "minimal" ||
    reasoningEffort === "low" ||
    reasoningEffort === "medium" ||
    reasoningEffort === "high" ||
    reasoningEffort === "xhigh"
  ) {
    return reasoningEffort;
  }

  throw new Error(
    `Unsupported reasoning effort "${reasoningEffort}". Expected none, minimal, low, medium, high, or xhigh.`,
  );
}
