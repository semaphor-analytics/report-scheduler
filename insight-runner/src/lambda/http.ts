export type FunctionUrlEvent = {
  rawPath?: string;
  path?: string;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

export type FunctionUrlResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const DEFAULT_BODY_LIMIT_BYTES = 1_000_000;

export function eventMethod(event: FunctionUrlEvent): string {
  return (
    event.requestContext?.http?.method ??
    ""
  ).toUpperCase();
}

export function eventPath(event: FunctionUrlEvent): string {
  return (
    event.rawPath ??
    event.requestContext?.http?.path ??
    event.path ??
    "/"
  );
}

export function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const direct = headers[name];
  if (direct !== undefined) {
    return direct;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

export function requireInternalApiKey(event: FunctionUrlEvent): void {
  const expected = process.env.LAMBDA_API_KEY?.trim();
  if (!expected) {
    throw new HttpError(500, "LAMBDA_API_KEY is not configured.");
  }

  const actual = headerValue(event.headers, "x-api-key")?.trim();
  if (actual !== expected) {
    throw new HttpError(401, "Unauthorized");
  }
}

export function readJsonBody(
  event: FunctionUrlEvent,
  limitBytes = DEFAULT_BODY_LIMIT_BYTES,
): unknown {
  const rawBody = event.body ?? "";
  const buffer = event.isBase64Encoded
    ? Buffer.from(rawBody, "base64")
    : Buffer.from(rawBody, "utf8");

  if (buffer.byteLength > limitBytes) {
    throw new HttpError(413, "Request body exceeds briefing runner limit.");
  }

  if (buffer.byteLength === 0) {
    return {};
  }

  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export function jsonResponse(
  statusCode: number,
  body: Record<string, unknown>,
): FunctionUrlResponse {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: `${JSON.stringify(body)}\n`,
  };
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorResponse(error: unknown): FunctionUrlResponse {
  if (error instanceof HttpError) {
    return jsonResponse(error.statusCode, {
      accepted: false,
      error: error.message,
    });
  }

  return jsonResponse(500, {
    accepted: false,
    error: error instanceof Error ? error.message : "Unexpected briefing runner error.",
  });
}
