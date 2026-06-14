import { describe, expect, it } from "vitest";
import {
  briefingThemeFromAppearance,
  type BriefingAppearanceSpec,
} from "../../src/artifacts/briefingThemeFromAppearance.js";
import {
  defaultReportTheme,
  mergeReportTheme,
} from "../../src/artifacts/reportTheme.js";

describe("briefingThemeFromAppearance", () => {
  it("converts hsl color tokens to hex and maps AppearanceSpec slots", () => {
    const spec: BriefingAppearanceSpec = {
      version: 1,
      schemes: {
        light: {
          tokens: {
            color: {
              background: "hsl(0 0% 100%)",
              foreground: "hsl(240 5.9% 10%)",
              muted: "hsl(0 0% 98%)",
              mutedForeground: "hsl(240 3.8% 46.1%)",
              border: "hsl(240 5.9% 90%)",
              primary: "hsl(240 5.9% 10%)",
              info: "hsl(217 91% 53%)",
              positive: "#16a34a",
              negative: "#dc2626",
              warning: "#d97706",
            },
            typography: {
              fontFamily: '"Open Sans", Arial, sans-serif',
            },
          },
          components: {
            chart: { palette: ["#3b82f6", "#10b981"] },
          },
        },
      },
    };

    const partial = briefingThemeFromAppearance(spec);
    const merged = mergeReportTheme(partial);

    expect(merged.colors.background).toBe("#ffffff");
    // foreground hsl(240 5.9% 10%) ≈ #181a1f / similar zinc-950-ish
    expect(merged.colors.text.startsWith("#")).toBe(true);
    expect(merged.colors.muted).toMatch(/^#[0-9a-f]{6}$/);
    expect(merged.colors.panel).toMatch(/^#[0-9a-f]{6}$/);
    expect(merged.colors.border).toMatch(/^#[0-9a-f]{6}$/);
    // Default primary == foreground in app shadcn defaults — adapter swaps in
    // info as the brand accent for briefings.
    expect(merged.colors.primary).not.toBe(merged.colors.text);
    expect(merged.colors.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(merged.colors.positive).toBe("#16a34a");
    expect(merged.colors.negative).toBe("#dc2626");
    expect(merged.colors.warning).toBe("#d97706");
    expect(merged.typography.fontFamily).toContain("Open Sans");
    expect(merged.chartPalette).toEqual(["#3b82f6", "#10b981"]);
  });

  it("falls back to defaults when spec is missing or unparseable", () => {
    const merged = mergeReportTheme(briefingThemeFromAppearance(null));
    expect(merged.colors.text).toBe(defaultReportTheme.colors.text);
    expect(merged.colors.primary).toBe(defaultReportTheme.colors.primary);
    expect(merged.typography.fontFamily).toBe(
      defaultReportTheme.typography.fontFamily,
    );

    const garbage = briefingThemeFromAppearance({
      schemes: {
        light: {
          tokens: {
            color: {
              background: "rgb(255, 255, 255)", // unsupported syntax
              foreground: "not-a-color",
            } as never,
          },
        },
      },
    });
    const garbageMerged = mergeReportTheme(garbage);
    expect(garbageMerged.colors.background).toBe(
      defaultReportTheme.colors.background,
    );
    expect(garbageMerged.colors.text).toBe(defaultReportTheme.colors.text);
  });

  it("applies branding overrides on top", () => {
    const partial = briefingThemeFromAppearance(null, {
      brandName: "Acme",
      logoUrl: "https://cdn.example.com/logo.png",
      link: "#0ea5e9",
    });
    const merged = mergeReportTheme(partial);
    expect(merged.brandName).toBe("Acme");
    expect(merged.logoUrl).toBe("https://cdn.example.com/logo.png");
    expect(merged.colors.link).toBe("#0ea5e9");
  });

  it("uses primary directly when it isn't the dashboard near-black", () => {
    const partial = briefingThemeFromAppearance({
      schemes: {
        light: {
          tokens: {
            color: {
              foreground: "hsl(240 5.9% 10%)",
              primary: "hsl(217 91% 53%)",
            },
          },
        },
      },
    });
    expect(partial.colors?.primary).toMatch(/^#[0-9a-f]{6}$/);
    // Same value should also be wired as the link color when no override.
    expect(partial.colors?.link).toBe(partial.colors?.primary);
  });
});
