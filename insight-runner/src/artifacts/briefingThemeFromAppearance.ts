import type { PartialReportTheme } from "./reportTheme.js";

// Briefings consume a tenant's brand by reading the same AppearanceSpec that
// react-semaphor uses to theme dashboards. The structural input type below
// mirrors the subset of AppearanceSpec we actually consume, so this file
// stays portable until react-semaphor exposes a React-free subpath
// (e.g. "react-semaphor/briefing-theme") to share the canonical types.
//
// Source of truth for AppearanceSpec:
//   react-semaphor/src/lib/appearance/types.ts
//   react-semaphor/src/lib/appearance/defaults.ts

export type BriefingAppearanceColorTokens = Partial<{
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  positive: string;
  negative: string;
  warning: string;
  info: string;
}>;

export interface BriefingAppearanceTokens {
  color?: BriefingAppearanceColorTokens;
  typography?: {
    fontFamily?: string;
    monoFontFamily?: string;
  };
}

export interface BriefingAppearanceScheme {
  tokens?: BriefingAppearanceTokens;
  components?: {
    chart?: { palette?: string[] };
  };
}

export interface BriefingAppearanceSpec {
  version?: number;
  schemes?: {
    light?: BriefingAppearanceScheme;
    dark?: BriefingAppearanceScheme;
  };
}

export interface BriefingThemeOverrides {
  // Branding fragments — tenants who configure a logo or display name in
  // their AppearanceSpec extension can pass them through here.
  brandName?: string;
  logoUrl?: string;
  // Email-specific link color override. Most tenants should let this default.
  link?: string;
}

// Produce a PartialReportTheme from a tenant's AppearanceSpec. Always reads
// the light scheme — outbound email uses light surfaces; dark-mode handling
// is a separate concern (recipient-side prefers-color-scheme).
//
// Color values in AppearanceSpec may be hsl() or hex; both are converted to
// hex so email clients render predictably. Unparseable values are dropped
// (mergeReportTheme will fall back to defaults).
export function briefingThemeFromAppearance(
  spec: BriefingAppearanceSpec | null | undefined,
  overrides: BriefingThemeOverrides = {},
): PartialReportTheme {
  const scheme = spec?.schemes?.light ?? {};
  const colorIn = scheme.tokens?.color ?? {};
  const typography = scheme.tokens?.typography ?? {};
  const palette = scheme.components?.chart?.palette;

  const colors: NonNullable<PartialReportTheme["colors"]> = {};

  const background = toHex(colorIn.background);
  if (background) colors.background = background;

  const foreground = toHex(colorIn.foreground);
  if (foreground) colors.text = foreground;

  // AppearanceSpec uses `muted` for a soft surface and `mutedForeground` for
  // muted text. The briefing theme's `muted` slot is for muted text, so map
  // mutedForeground -> muted, and muted -> panel.
  const mutedForeground = toHex(colorIn.mutedForeground);
  if (mutedForeground) colors.muted = mutedForeground;

  const panel = toHex(colorIn.muted);
  if (panel) colors.panel = panel;

  const border = toHex(colorIn.border);
  if (border) colors.border = border;

  // Use AppearanceSpec's `primary` only if it isn't the dashboard near-black
  // (zinc-950). The default app primary is dark for shadcn neutrality, but a
  // briefing's primary should be the brand accent. Heuristic: if primary
  // matches foreground, prefer `info` as the brand accent.
  const primaryRaw = toHex(colorIn.primary);
  const infoRaw = toHex(colorIn.info);
  const primary =
    primaryRaw && foreground && primaryRaw === foreground ? infoRaw : primaryRaw;
  if (primary) colors.primary = primary;
  if (overrides.link) {
    colors.link = overrides.link;
  } else if (primary) {
    colors.link = primary;
  }

  const primaryForeground = toHex(colorIn.primaryForeground);
  if (primaryForeground) colors.primaryForeground = primaryForeground;

  const positive = toHex(colorIn.positive);
  if (positive) colors.positive = positive;

  const negative = toHex(colorIn.negative);
  if (negative) colors.negative = negative;

  const warning = toHex(colorIn.warning);
  if (warning) colors.warning = warning;

  const theme: PartialReportTheme = { colors };

  if (typography.fontFamily || typography.monoFontFamily) {
    theme.typography = {};
    if (typography.fontFamily) theme.typography.fontFamily = typography.fontFamily;
    if (typography.monoFontFamily)
      theme.typography.monoFontFamily = typography.monoFontFamily;
  }

  if (palette?.length) {
    const cleaned = palette
      .map((color) => toHex(color))
      .filter((color): color is string => Boolean(color));
    if (cleaned.length) theme.chartPalette = cleaned;
  }

  if (overrides.brandName) theme.brandName = overrides.brandName;
  if (overrides.logoUrl) theme.logoUrl = overrides.logoUrl;

  return theme;
}

// Convert a CSS color string (hex, hsl(), hsla()) to a 7-char hex. Returns
// null for unparseable inputs so the caller can fall back to defaults.
function toHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("#")) {
    return normalizeHex(trimmed);
  }
  if (trimmed.startsWith("hsl")) {
    return hslToHex(trimmed);
  }
  return undefined;
}

function normalizeHex(value: string): string | undefined {
  if (value.length === 7 && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase();
  }
  if (value.length === 4 && /^#[0-9a-fA-F]{3}$/.test(value)) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return undefined;
}

// Parse hsl() or hsla() in modern (space-separated) or legacy (comma)
// notation. Drops alpha — emails don't reliably honor partial transparency.
function hslToHex(value: string): string | undefined {
  const match = value.match(/hsla?\s*\(([^)]+)\)/i);
  if (!match) return undefined;
  const parts = match[1]
    .replace(/\//g, " ")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 3) return undefined;

  const h = parseFloat(parts[0]);
  const s = parsePercent(parts[1]);
  const l = parsePercent(parts[2]);
  if (!Number.isFinite(h) || s === null || l === null) return undefined;

  const sNorm = clamp01(s / 100);
  const lNorm = clamp01(l / 100);
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const hPrime = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = lNorm - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function parsePercent(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const n = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toHexByte(value: number): string {
  const clamped = Math.max(0, Math.min(255, value));
  return clamped.toString(16).padStart(2, "0");
}
