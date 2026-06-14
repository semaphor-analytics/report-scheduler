import { describe, expect, it } from "vitest";
import {
  normalizeDeliveryPlan,
  prepareDryRunDelivery,
} from "../../src/delivery/deliveryPlan.js";

describe("deliveryPlan", () => {
  it("normalizes email and Slack delivery intent", () => {
    const plan = normalizeDeliveryPlan({
      deliveryIntent:
        "Send a summary and PDF to ops@example.com and Slack #revenue-alerts.",
    });

    expect(plan).toEqual({
      dryRun: true,
      channels: [
        {
          channel: "email",
          target: "ops@example.com",
          mode: "summary_and_pdf",
        },
        {
          channel: "slack",
          target: "#revenue-alerts",
          mode: "summary_and_pdf",
        },
      ],
    });
  });

  it("prepares dry-run payloads without sending", () => {
    const plan = normalizeDeliveryPlan({
      deliveryIntent: "Email finance@example.com the PDF attachment.",
    });
    const prepared = prepareDryRunDelivery({
      plan,
      summary: "Revenue increased.",
      pdfPath: "runs/weekly.pdf",
    });

    expect(prepared).toEqual({
      dryRun: true,
      deliveries: [
        {
          channel: "email",
          target: "finance@example.com",
          mode: "pdf",
          summary: "",
          attachments: ["runs/weekly.pdf"],
        },
      ],
    });
  });
});
