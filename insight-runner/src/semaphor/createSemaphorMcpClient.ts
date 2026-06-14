import { FakeSemaphorMcpClient } from "./fakeSemaphorMcpClient.js";
import { SdkSemaphorMcpClient } from "./sdkSemaphorMcpClient.js";
import type { SemaphorMcpClient } from "./semaphorToolTypes.js";

export interface CreateSemaphorMcpClientOptions {
  mcpUrl: string;
  token: string;
  fake?: boolean;
  requestTimeoutMs?: number;
}

export function createSemaphorMcpClient(
  options: CreateSemaphorMcpClientOptions,
): SemaphorMcpClient {
  if (options.fake) {
    return new FakeSemaphorMcpClient();
  }

  return new SdkSemaphorMcpClient({
    mcpUrl: options.mcpUrl,
    token: options.token,
    requestTimeoutMs: options.requestTimeoutMs,
  });
}
