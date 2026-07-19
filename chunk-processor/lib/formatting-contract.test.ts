import { parseExportFormattingConfig } from './formatting-contract';

const REPORT_CONTEXT = {
  calendar: { tz: 'UTC', weekStart: 1, anchor: 'now' },
  valueFormat: {
    locale: 'en-US',
    dateStyle: 'short',
    dateTime: { dateStyle: 'short', timeStyle: 'short' },
    defaultCurrency: 'USD',
  },
  preferenceSources: {
    calendar: { tz: 'system_default', weekStart: 'system_default' },
    valueFormat: {
      locale: 'system_default',
      dateStyle: 'system_default',
      dateTime: {
        dateStyle: 'system_default',
        timeStyle: 'system_default',
      },
      defaultCurrency: 'system_default',
    },
  },
} as const;

function formatting(overrides: Record<string, unknown> = {}) {
  return {
    scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
    useFormattedValues: false,
    timezone: 'UTC',
    reportContext: REPORT_CONTEXT,
    delimiter: ',',
    includeHeaders: true,
    resolvedNumericFormats: [],
    ...overrides,
  };
}

function resolvedColumnFormat(
  dashboardId: string,
  cardId: string,
  columnKey: string,
) {
  return {
    scope: { dashboardId, cardId },
    target: { kind: 'column', columnKey },
    format: {
      type: 'currency',
      locale: 'en-US',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  };
}

describe('parseExportFormattingConfig', () => {
  it('revalidates and normalizes the immutable presentation snapshot', () => {
    expect(parseExportFormattingConfig(formatting())).toEqual(
      expect.objectContaining({
        timezone: 'UTC',
        reportContext: REPORT_CONTEXT,
        resolvedNumericFormats: [],
      }),
    );
  });

  it('rejects a missing or invalid report context without a fallback', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({ reportContext: undefined }),
      ),
    ).toThrow('reportContext is invalid');
    expect(() =>
      parseExportFormattingConfig(
        formatting({
          reportContext: {
            ...REPORT_CONTEXT,
            calendar: { ...REPORT_CONTEXT.calendar, weekStart: 7 },
          },
        }),
      ),
    ).toThrow('weekStart');
  });

  it('rejects retired worker presentation state and derived-timezone drift', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({ locale: 'en-US' }),
      ),
    ).toThrow('unknown property "locale"');
    expect(() =>
      parseExportFormattingConfig(
        formatting({ comparisonPresentation: {} }),
      ),
    ).toThrow('unknown property "comparisonPresentation"');
    expect(() =>
      parseExportFormattingConfig(
        formatting({ timezone: 'America/Chicago' }),
      ),
    ).toThrow('must equal reportContext.calendar.tz');
  });

  it('rejects mismatched scopes and non-column presentation targets', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({
          resolvedNumericFormats: [
            resolvedColumnFormat('dashboard-1', 'card-1', 'revenue'),
            resolvedColumnFormat('dashboard-1', 'card-2', 'margin'),
          ],
        }),
      ),
    ).toThrow('scope must match the executing dashboard/card');

    expect(() =>
      parseExportFormattingConfig(
        formatting({
          resolvedNumericFormats: [
            {
              ...resolvedColumnFormat(
                'dashboard-1',
                'card-1',
                'revenue',
              ),
              target: { kind: 'metric', metricId: 'revenue' },
            },
          ],
        }),
      ),
    ).toThrow(
      'formatting.resolvedNumericFormats.0.target must identify an export column',
    );
  });

  it('requires one carried format for every formatted visible column', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({
          useFormattedValues: true,
          visibleColumns: ['revenue'],
          resolvedNumericFormats: [],
        }),
      ),
    ).toThrow(
      'formatting.resolvedNumericFormats is missing visible export column "revenue"',
    );

    expect(
      parseExportFormattingConfig(
        formatting({
          useFormattedValues: true,
          visibleColumns: ['revenue'],
          resolvedNumericFormats: [
            resolvedColumnFormat('dashboard-1', 'card-1', 'revenue'),
          ],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        visibleColumns: ['revenue'],
        resolvedNumericFormats: [
          expect.objectContaining({
            target: { kind: 'column', columnKey: 'revenue' },
          }),
        ],
      }),
    );
  });

  it('rejects a pre-Phase-E payload without the required snapshot', () => {
    expect(() =>
      parseExportFormattingConfig({
        useFormattedValues: true,
        timezone: 'UTC',
        delimiter: ',',
        includeHeaders: true,
        columnSettings: {
          revenue: {
            numberFormat: {
              style: 'currency',
              currency: 'EUR',
            },
          },
        },
      }),
    ).toThrow('formatting.scope must be an object');
  });
});
