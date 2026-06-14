import type {
  BriefingRunnerPayload,
  BriefingTriggerSource,
} from "./briefingRunnerPayload.js";

export type BriefingRunnerResultStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export type BriefingContentScalar = string | number | boolean | null;

export type BriefingContentSeverity =
  | "info"
  | "positive"
  | "warning"
  | "critical";

export type BriefingContentColumnKind =
  | "text"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "boolean";

export type BriefingContentColumnAlign = "left" | "center" | "right";

export type BriefingContentTableColumn = {
  key: string;
  label: string;
  kind?: BriefingContentColumnKind;
  align?: BriefingContentColumnAlign;
};

export type BriefingContentTableBlock = {
  type: "table";
  id?: string;
  title?: string;
  columns: BriefingContentTableColumn[];
  rows: Array<Record<string, BriefingContentScalar>>;
  caption?: string;
  totalRows?: number;
  evidenceIds?: string[];
};

export type BriefingKpiTile = {
  label: string;
  value: string | number;
  previousValue?: string | number | null;
  delta?: string | number | null;
  unit?: string;
  evidenceIds?: string[];
};

export type BriefingContentBlock =
  | { type: "heading"; text: string; level?: 2 | 3; evidenceIds?: string[] }
  | { type: "paragraph"; text: string; evidenceIds?: string[] }
  | {
      type: "finding";
      title?: string;
      text: string;
      severity?: BriefingContentSeverity;
      evidenceIds: string[];
    }
  | { type: "bullets"; title?: string; items: string[]; evidenceIds?: string[] }
  | {
      type: "metric";
      label: string;
      value: string | number;
      previousValue?: string | number | null;
      delta?: string | number | null;
      unit?: string;
      evidenceIds?: string[];
    }
  | {
      // Multiple metrics rendered as a visible tile grid (2-up in email,
      // 1-up on mobile). Use when the user's intent is a snapshot of numbers
      // ("show me the KPIs", "weekly metrics", "dashboard summary"). For a
      // single number woven into prose, use `metric` instead.
      type: "kpi_grid";
      title?: string;
      tiles: BriefingKpiTile[];
      evidenceIds?: string[];
    }
  | {
      type: "progress";
      label: string;
      value: number;
      detail?: string;
      evidenceIds?: string[];
    }
  | BriefingContentTableBlock
  | { type: "actions"; title?: string; items: string[]; evidenceIds?: string[] }
  | { type: "limitations"; title?: string; items: string[]; evidenceIds?: string[] }
  | { type: "sql"; title?: string; sql: string; evidenceIds?: string[] }
  | { type: "evidence_appendix"; title?: string; evidenceIds: string[] };

export type BriefingContentDocument = {
  version: 1;
  title?: string;
  summary?: string;
  blocks: BriefingContentBlock[];
};

export type BriefingRunProgressStage =
  | "queued"
  | "planning"
  | "discovering"
  | "inspecting"
  | "querying"
  | "analyzing"
  | "rendering"
  | "saving"
  | "completed"
  | "failed";

export type BriefingRunProgress = {
  stage: BriefingRunProgressStage;
  label: string;
  detail?: string;
  eventCount: number;
  updatedAt: string;
  recentEvents?: Array<{
    stage: BriefingRunProgressStage;
    label: string;
    updatedAt: string;
  }>;
};

export type BriefingRunnerResultPayload = {
  status: BriefingRunnerResultStatus;
  title?: string;
  summary?: string;
  content?: BriefingContentDocument;
  artifacts: {
    markdown?: string;
    html?: string;
    // Plain-text alternative for multipart/alternative emails. Required by
    // many spam filters and screen readers; produced alongside HTML by the
    // typed ReportDocument renderer.
    text?: string;
  };
  evidence?: unknown;
  trace?: unknown;
  diagnosticFeedback?: unknown;
  warnings: string[];
  limits?: Record<string, unknown>;
};

export type BriefingCompleteCallbackBody = {
  triggerSource: BriefingTriggerSource;
  result: BriefingRunnerResultPayload;
};

export type BriefingFailCallbackBody = {
  triggerSource: BriefingTriggerSource;
  error: string;
  result?: BriefingRunnerResultPayload;
};

export type BriefingProgressCallbackBody = {
  triggerSource: BriefingTriggerSource;
  progress: BriefingRunProgress;
};

export interface BriefingCallbackClient {
  complete(
    payload: BriefingRunnerPayload,
    body: BriefingCompleteCallbackBody,
  ): Promise<void>;
  fail(
    payload: BriefingRunnerPayload,
    body: BriefingFailCallbackBody,
  ): Promise<void>;
  progress?(
    payload: BriefingRunnerPayload,
    body: BriefingProgressCallbackBody,
  ): Promise<void>;
}

type FetchLike = typeof fetch;

const DEFAULT_CALLBACK_TIMEOUT_MS = 30_000;

export class HttpBriefingCallbackClient implements BriefingCallbackClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = resolveCallbackTimeoutMs(),
  ) {}

  async complete(
    payload: BriefingRunnerPayload,
    body: BriefingCompleteCallbackBody,
  ): Promise<void> {
    await this.post(payload.callback.completeUrl, payload, body);
  }

  async fail(
    payload: BriefingRunnerPayload,
    body: BriefingFailCallbackBody,
  ): Promise<void> {
    await this.post(payload.callback.failUrl, payload, body);
  }

  async progress(
    payload: BriefingRunnerPayload,
    body: BriefingProgressCallbackBody,
  ): Promise<void> {
    if (!payload.callback.progressUrl) {
      return;
    }

    await this.post(payload.callback.progressUrl, payload, body);
  }

  private async post(
    url: string,
    payload: BriefingRunnerPayload,
    body:
      | BriefingCompleteCallbackBody
      | BriefingFailCallbackBody
      | BriefingProgressCallbackBody,
  ): Promise<void> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<Response>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`Briefing callback timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    const response = await Promise.race([this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [payload.callback.auth.headerName]: payload.callback.auth.value,
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    }), timeoutPromise]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });

    if (!response.ok) {
      const errorMessage = await readErrorMessage(response);
      throw new Error(errorMessage || `Briefing callback returned HTTP ${response.status}`);
    }
  }
}

function resolveCallbackTimeoutMs(): number {
  const raw = process.env.BRIEFINGS_CALLBACK_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_CALLBACK_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CALLBACK_TIMEOUT_MS;
  }

  return parsed;
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    return text;
  }

  return text;
}
