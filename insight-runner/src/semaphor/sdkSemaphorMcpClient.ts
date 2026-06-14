import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  SemaphorMcpClient,
  SemaphorToolCall,
  SemaphorToolResult,
} from "./semaphorToolTypes.js";

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 60_000;

type MpcCallToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<unknown>;
  _meta?: unknown;
};

export interface SdkSemaphorMcpClientOptions {
  mcpUrl: string;
  token: string;
  clientName?: string;
  clientVersion?: string;
  requestTimeoutMs?: number;
}

export class SdkSemaphorMcpClient implements SemaphorMcpClient {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private connecting?: Promise<Client>;

  constructor(private readonly options: SdkSemaphorMcpClientOptions) {}

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    try {
      const client = await this.getClient();
      const result = (await client.callTool({
        name: call.name,
        arguments: call.arguments,
      }, undefined, {
        timeout: this.options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
        maxTotalTimeout:
          this.options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
      })) as MpcCallToolResult;

      return normalizeMcpToolResult<T>(call.name, result);
    } catch (error) {
      return {
        toolName: call.name,
        ok: false,
        error: normalizeClientError(error),
      };
    }
  }

  async listTools(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>
  > {
    const client = await this.getClient();
    const result = await client.listTools(
      {},
      {
        timeout: this.options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
        maxTotalTimeout:
          this.options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
      },
    );
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.client = undefined;
    this.transport = undefined;
    this.connecting = undefined;
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connect();
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const client = new Client({
      name: this.options.clientName ?? "semaphor-insight-loop-runner",
      version: this.options.clientVersion ?? "0.1.0",
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(this.options.mcpUrl),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.options.token}`,
          },
        },
      },
    );

    await client.connect(transport);
    this.client = client;
    this.transport = transport;
    return client;
  }
}

export function normalizeMcpToolResult<T = unknown>(
  toolName: string,
  result: MpcCallToolResult,
): SemaphorToolResult<T> {
  const contentText = extractTextContent(result.content);
  const data =
    result.structuredContent ??
    parseJsonObject(contentText) ??
    (contentText ? { text: contentText } : undefined);

  if (result.isError || looksLikeToolError(contentText)) {
    return {
      toolName,
      ok: false,
      error: {
        code: "mcp_tool_error",
        message: contentText || `${toolName} returned an MCP error.`,
        details: data,
      },
      metadata: {
        mcp: true,
      },
    };
  }

  return {
    toolName,
    ok: true,
    data: data as T,
    metadata: {
      mcp: true,
    },
  };
}

function looksLikeToolError(text: string): boolean {
  return /^error\s*:/i.test(text);
}

function normalizeClientError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof Error) {
    return {
      code: error.name || "mcp_client_error",
      message: error.message,
    };
  }

  return {
    code: "mcp_client_error",
    message: String(error),
  };
}

function extractTextContent(content: Array<unknown> | undefined): string {
  if (!content) {
    return "";
  }

  return content
    .map((item) => {
      if (item && typeof item === "object" && "text" in item) {
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseJsonObject(text: string): unknown | undefined {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
