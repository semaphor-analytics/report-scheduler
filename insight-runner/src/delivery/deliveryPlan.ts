export type DeliveryChannel = "email" | "slack";
export type DeliveryMode = "summary" | "pdf" | "summary_and_pdf";

export interface DeliveryPlan {
  channels: Array<{
    channel: DeliveryChannel;
    target: string;
    mode: DeliveryMode;
  }>;
  dryRun: boolean;
}

export interface PreparedDelivery {
  dryRun: true;
  deliveries: Array<{
    channel: DeliveryChannel;
    target: string;
    mode: DeliveryMode;
    summary: string;
    attachments: string[];
  }>;
}

export function normalizeDeliveryPlan(input: {
  deliveryIntent?: string;
  dryRun?: boolean;
}): DeliveryPlan {
  const text = input.deliveryIntent?.trim();
  if (!text) {
    return {
      channels: [],
      dryRun: input.dryRun ?? true,
    };
  }

  const mode = inferDeliveryMode(text);
  const channels: DeliveryPlan["channels"] = [];
  for (const target of extractEmails(text)) {
    channels.push({
      channel: "email",
      target,
      mode,
    });
  }

  for (const target of extractSlackTargets(text)) {
    channels.push({
      channel: "slack",
      target,
      mode,
    });
  }

  if (channels.length === 0 && /\bemail\b/i.test(text)) {
    channels.push({
      channel: "email",
      target: "unspecified",
      mode,
    });
  }

  if (channels.length === 0 && /\bslack\b/i.test(text)) {
    channels.push({
      channel: "slack",
      target: "unspecified",
      mode,
    });
  }

  return {
    channels,
    dryRun: input.dryRun ?? true,
  };
}

export function prepareDryRunDelivery(input: {
  plan: DeliveryPlan;
  summary: string;
  pdfPath?: string;
}): PreparedDelivery {
  return {
    dryRun: true,
    deliveries: input.plan.channels.map((channel) => ({
      ...channel,
      summary:
        channel.mode === "pdf"
          ? ""
          : truncate(input.summary.replace(/\s+/g, " ").trim(), 1200),
      attachments:
        channel.mode === "pdf" || channel.mode === "summary_and_pdf"
          ? [input.pdfPath ?? "artifact.pdf"]
          : [],
    })),
  };
}

function inferDeliveryMode(value: string): DeliveryMode {
  const mentionsPdf = /\bpdf\b|attachment/i.test(value);
  const mentionsSummary = /\bsummary\b|message|text/i.test(value);
  if (mentionsPdf && mentionsSummary) {
    return "summary_and_pdf";
  }
  if (mentionsPdf) {
    return "pdf";
  }
  return "summary";
}

function extractEmails(value: string): string[] {
  return Array.from(
    new Set(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
  );
}

function extractSlackTargets(value: string): string[] {
  const targets = new Set<string>();
  const channelMatches = value.match(/#[a-z0-9][a-z0-9_-]*/gi) ?? [];
  channelMatches.forEach((target) => targets.add(target));

  const slackToMatches = value.match(/slack\s+(?:to|in|channel)\s+([a-z0-9#_-]+)/gi) ?? [];
  slackToMatches.forEach((match) => {
    const target = match.split(/\s+/).at(-1);
    if (target) {
      targets.add(target);
    }
  });

  return Array.from(targets);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
