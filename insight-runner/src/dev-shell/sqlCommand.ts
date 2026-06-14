export interface SqlCommandArgs {
  connectionId: string;
  sql: string;
}

export function resolveSqlCommandArgs(args: string[]): SqlCommandArgs | { error: string } {
  const [connectionId, ...sqlParts] = args;
  const sql = sqlParts.join(" ").trim();

  if (!connectionId || !sql) {
    return {
      error:
        "Usage: /sql <connectionId> <sql>. Use a read-only SELECT with an explicit LIMIT for row-level queries.",
    };
  }

  if (!/^\s*(select|with)\b/i.test(sql)) {
    return {
      error: "Only read-only SELECT/WITH SQL is allowed from the local workbench.",
    };
  }

  if (/\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)) {
    return {
      error: "Write or DDL SQL is not allowed from the local workbench.",
    };
  }

  if (!/\blimit\s+\d+\b/i.test(sql)) {
    return {
      error:
        "SQL must include an explicit LIMIT. Add an outer LIMIT, for example LIMIT 100, before retrying.",
    };
  }

  return {
    connectionId,
    sql,
  };
}
