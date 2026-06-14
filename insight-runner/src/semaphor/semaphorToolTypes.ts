export type SemaphorToolName =
  | "semaphor_get_analysis_context"
  | "semaphor_get_dashboard_analysis_context"
  | "semaphor_list_semantic_domains"
  | "semaphor_list_datasets"
  | "semaphor_get_dataset_schema"
  | "semaphor_plan_analytics_recovery"
  | "semaphor_analyze"
  | "semaphor_query_sql_advanced";

export interface SemaphorToolCall {
  name: SemaphorToolName | string;
  arguments: Record<string, unknown>;
}

export interface SemaphorToolResult<T = unknown> {
  toolName: string;
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface SemaphorMcpClient {
  callTool<T = unknown>(call: SemaphorToolCall): Promise<SemaphorToolResult<T>>;
  listTools?(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>
  >;
  close?(): Promise<void>;
}

export interface AnalysisContext {
  project?: {
    id?: string;
    name?: string;
  };
  semanticDomains?: Array<{
    id?: string;
    name?: string;
    label?: string | null;
    description?: string | null;
  }>;
  actor?: {
    type?: "organization" | "tenant" | string;
    tenantId?: string;
  };
  guidance?: string[];
}
