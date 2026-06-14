export interface ReportTheme {
  brandName?: string;
  logoUrl?: string;
  colors: {
    background: string;
    panel: string;
    text: string;
    muted: string;
    subtle: string;
    border: string;
    subtleBorder: string;
    primary: string;
    primaryForeground: string;
    positive: string;
    negative: string;
    warning: string;
    link: string;
  };
  typography: {
    fontFamily: string;
    monoFontFamily: string;
  };
  page: {
    widthPx: number;
    margin: string;
  };
  chartPalette: string[];
}

// Defaults are anchored to semaphor-app/brand/BRAND.md and the AppearanceSpec
// defaults in react-semaphor/src/lib/appearance/defaults.ts. When tenant
// branding is available, derive a theme via briefingThemeFromAppearance()
// instead of overriding fields ad hoc.
export const defaultReportTheme: ReportTheme = {
  colors: {
    background: "#ffffff",
    panel: "#fafafa",
    text: "#09090b",
    muted: "#52525b",
    subtle: "#71717a",
    border: "#e4e4e7",
    subtleBorder: "#f4f4f5",
    primary: "#3b82f6",
    primaryForeground: "#ffffff",
    positive: "#16a34a",
    negative: "#dc2626",
    warning: "#d97706",
    link: "#2563eb",
  },
  typography: {
    // Lead with Open Sans for brand consistency when it's available in the
    // rendering context (e.g., the React preview inside semaphor-app, which
    // already loads Open Sans for the product UI). In real email clients
    // where Open Sans isn't installed locally, the browser walks the stack
    // and renders Arial — clean fallback.
    //
    // Important: do NOT add an @import url(...) for Open Sans anywhere in
    // the email. Outlook desktop's infamous Times-New-Roman fallback only
    // triggers when an @import font load fails. With a plain font-family
    // stack and no import, Outlook walks the stack normally.
    //
    // Tenants who want Inter, IBM Plex, or another brand font configure it
    // via AppearanceSpec; the briefing theme adapter lifts that into this
    // slot.
    fontFamily: '"Open Sans", Arial, "Helvetica Neue", Helvetica, sans-serif',
    monoFontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
  page: {
    widthPx: 720,
    margin: "0.55in",
  },
  chartPalette: [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#84cc16",
    "#f97316",
  ],
};

export function mergeReportTheme(theme?: PartialReportTheme): ReportTheme {
  if (!theme) {
    return defaultReportTheme;
  }

  return {
    ...defaultReportTheme,
    ...theme,
    colors: {
      ...defaultReportTheme.colors,
      ...theme.colors,
    },
    typography: {
      ...defaultReportTheme.typography,
      ...theme.typography,
    },
    page: {
      ...defaultReportTheme.page,
      ...theme.page,
    },
    chartPalette: theme.chartPalette ?? defaultReportTheme.chartPalette,
  };
}

export type PartialReportTheme = Partial<
  Omit<ReportTheme, "colors" | "typography" | "page">
> & {
  colors?: Partial<ReportTheme["colors"]>;
  typography?: Partial<ReportTheme["typography"]>;
  page?: Partial<ReportTheme["page"]>;
};
