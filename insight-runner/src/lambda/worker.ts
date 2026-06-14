import { executeBriefingRun } from "../briefings/executeBriefingRun.js";
import { parseBriefingRunnerPayload } from "../briefings/briefingRunnerPayload.js";

type LambdaContext = {
  awsRequestId?: string;
  getRemainingTimeInMillis?: () => number;
};

const CALLBACK_SAFETY_WINDOW_MS = 20_000;
const MIN_RUNNER_TIMEOUT_MS = 1_000;

export async function handler(
  event: unknown,
  context: LambdaContext = {},
): Promise<{ ok: true; runId: string }> {
  const payload = parseBriefingRunnerPayload(event);
  const requestTimeoutMs = runnerTimeoutMs(context);

  console.log("[insight-runner] worker started", {
    runId: payload.runId,
    ruleId: payload.ruleId,
    awsRequestId: context.awsRequestId,
    triggerSource: payload.triggerSource,
    sourceType: payload.briefing.jobConfig.source.type,
    bodyType: payload.briefing.jobConfig.body.type,
    attachmentCount: payload.briefing.jobConfig.attachments.length,
    requestTimeoutMs,
  });

  await executeBriefingRun({
    payload,
    requestTimeoutMs,
    model: {
      provider: process.env.INSIGHT_LOOP_MODEL_PROVIDER,
      name: process.env.INSIGHT_LOOP_MODEL,
    },
    onEvent: (event) => {
      console.log("[insight-runner] run event", {
        runId: payload.runId,
        type: event.type,
        message: event.message,
      });
    },
  });

  console.log("[insight-runner] worker completed", {
    runId: payload.runId,
    ruleId: payload.ruleId,
  });

  return { ok: true, runId: payload.runId };
}

function runnerTimeoutMs(context: LambdaContext): number | undefined {
  const remaining = context.getRemainingTimeInMillis?.();
  if (!remaining) {
    return undefined;
  }

  return Math.max(MIN_RUNNER_TIMEOUT_MS, remaining - CALLBACK_SAFETY_WINDOW_MS);
}
