import { describe, expect, it } from "vitest";
import { resolveSqlCommandArgs } from "../../src/dev-shell/sqlCommand.js";

describe("resolveSqlCommandArgs", () => {
  it("accepts read-only SQL", () => {
    expect(resolveSqlCommandArgs(["conn_1", "select", "1", "limit", "1"])).toEqual({
      connectionId: "conn_1",
      sql: "select 1 limit 1",
    });
  });

  it("rejects SQL with no explicit limit", () => {
    expect(resolveSqlCommandArgs(["conn_1", "select", "1"])).toEqual({
      error:
        "SQL must include an explicit LIMIT. Add an outer LIMIT, for example LIMIT 100, before retrying.",
    });
  });

  it("rejects write SQL", () => {
    expect(resolveSqlCommandArgs(["conn_1", "delete", "from", "users"])).toEqual({
      error: "Only read-only SELECT/WITH SQL is allowed from the local workbench.",
    });
  });

  it("requires a connection and SQL", () => {
    expect(resolveSqlCommandArgs(["conn_1"])).toEqual({
      error:
        "Usage: /sql <connectionId> <sql>. Use a read-only SELECT with an explicit LIMIT for row-level queries.",
    });
  });
});
