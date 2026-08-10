import type { ReportRuntimeContext } from "react-semaphor/report-runtime-context";
import type { PresentationExecutionSnapshot } from "react-semaphor/format-utils";

export const TEST_REPORT_CONTEXT: ReportRuntimeContext = {
  calendar: {
    tz: "UTC",
    weekStart: 1,
    anchor: "now",
  },
  valueFormat: {
    locale: "en-US",
    dateStyle: "short",
    dateTime: {
      dateStyle: "short",
      timeStyle: "short",
    },
    defaultCurrency: "USD",
  },
  preferenceSources: {
    calendar: {
      tz: "system_default",
      weekStart: "system_default",
    },
    valueFormat: {
      locale: "system_default",
      dateStyle: "system_default",
      dateTime: {
        dateStyle: "system_default",
        timeStyle: "system_default",
      },
      defaultCurrency: "system_default",
    },
  },
};

export const TEST_PRESENTATION_EXECUTION_SNAPSHOT: PresentationExecutionSnapshot = {
  version: 1,
  reportContext: TEST_REPORT_CONTEXT,
  resolvedFormats: [],
};
