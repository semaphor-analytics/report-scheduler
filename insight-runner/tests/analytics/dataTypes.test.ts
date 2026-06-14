import { describe, expect, it } from "vitest";
import {
  isDateLikeDataType,
  isDateLikeField,
  isNumericLikeDataType,
} from "../../src/analytics/dataTypes.js";

describe("analytics data type utilities", () => {
  it("keeps broad warehouse date and datetime coverage centralized", () => {
    expect(isDateLikeDataType("Date")).toBe(true);
    expect(isDateLikeDataType("Date32")).toBe(true);
    expect(isDateLikeDataType("Nullable(Date)")).toBe(true);
    expect(isDateLikeDataType("DateTime64(3)")).toBe(true);
    expect(isDateLikeDataType("Nullable(DateTime64(3))")).toBe(true);
    expect(isDateLikeDataType("TIMESTAMP WITH TIME ZONE")).toBe(true);
    expect(isDateLikeDataType("timestamp_ltz")).toBe(true);
    expect(isDateLikeDataType("datetimeoffset")).toBe(true);
    expect(isDateLikeDataType("time(6)")).toBe(true);
    expect(isDateLikeDataType("timetz")).toBe(true);
    expect(isDateLikeDataType("Nullable(Time)")).toBe(true);
  });

  it("uses role and numeric type signals without classifying identifiers as metrics", () => {
    expect(isDateLikeField({ name: "created_at", role: "date" })).toBe(true);
    expect(isNumericLikeDataType("Decimal(18,2)")).toBe(true);
    expect(isNumericLikeDataType("percent")).toBe(true);
  });
});
