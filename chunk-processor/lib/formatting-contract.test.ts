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
    presentationExecutionSnapshot: {
      version: 1,
      reportContext: REPORT_CONTEXT,
      resolvedFormats: [],
    },
    delimiter: ',',
    includeHeaders: true,
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
        presentationExecutionSnapshot: {
          version: 1,
          reportContext: REPORT_CONTEXT,
          resolvedFormats: [],
        },
      }),
    );
  });

  it('accepts the activated temporal export-column branch', () => {
    expect(
      parseExportFormattingConfig(
        formatting({
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: REPORT_CONTEXT,
            resolvedFormats: [
            {
              scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
              target: { kind: 'column', columnKey: 'order_month' },
              format: {
                type: 'temporal_bucket',
                presentation: {
                  mode: 'auto',
                  styles: {
                    dateStyle: 'short',
                    dateTime: { dateStyle: 'short', timeStyle: 'short' },
                  },
                },
                locale: 'en-US',
              },
            },
            ],
          },
        }),
      ).presentationExecutionSnapshot.resolvedFormats,
    ).toEqual([
      expect.objectContaining({
        target: { kind: 'column', columnKey: 'order_month' },
        format: expect.objectContaining({ type: 'temporal_bucket' }),
      }),
    ]);
  });

  it('rejects a missing or invalid presentation snapshot without a fallback', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({ presentationExecutionSnapshot: undefined }),
      ),
    ).toThrow('presentation execution snapshot');
    expect(() =>
      parseExportFormattingConfig(
        formatting({
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: {
              ...REPORT_CONTEXT,
              calendar: { ...REPORT_CONTEXT.calendar, weekStart: 7 },
            },
            resolvedFormats: [],
          },
        }),
      ),
    ).toThrow('weekStart');
  });

  it.each(['reportContext', 'resolvedFormats'])(
    'rejects the retired formatting.%s sibling with the typed resave action',
    (retiredKey) => {
      expect(() =>
        parseExportFormattingConfig(
          formatting({
            [retiredKey]: retiredKey === 'reportContext' ? REPORT_CONTEXT : [],
          }),
        ),
      ).toThrow('invalid_presentation_execution_snapshot');
    },
  );

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
        formatting({ resolvedNumericFormats: [] }),
      ),
    ).toThrow('unknown property "resolvedNumericFormats"');
    expect(() =>
      parseExportFormattingConfig(
        formatting({ timezone: 'America/Chicago' }),
      ),
    ).toThrow(
      'must equal presentationExecutionSnapshot.reportContext.calendar.tz',
    );
  });

  it('rejects mismatched scopes and non-column presentation targets', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: REPORT_CONTEXT,
            resolvedFormats: [
              resolvedColumnFormat('dashboard-1', 'card-1', 'revenue'),
              resolvedColumnFormat('dashboard-1', 'card-2', 'margin'),
            ],
          },
        }),
      ),
    ).toThrow('scope must match the executing dashboard/card');

    expect(() =>
      parseExportFormattingConfig(
        formatting({
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: REPORT_CONTEXT,
            resolvedFormats: [{
              ...resolvedColumnFormat(
                'dashboard-1',
                'card-1',
                'revenue',
              ),
              target: { kind: 'metric', metricId: 'revenue' },
            }],
          },
        }),
      ),
    ).toThrow(
      'formatting.presentationExecutionSnapshot.resolvedFormats.0.target must identify an export column',
    );
  });

  it('requires one carried format for every formatted visible column', () => {
    expect(() =>
      parseExportFormattingConfig(
        formatting({
          useFormattedValues: true,
          visibleColumns: ['revenue'],
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: REPORT_CONTEXT,
            resolvedFormats: [],
          },
        }),
      ),
    ).toThrow(
      'formatting.presentationExecutionSnapshot.resolvedFormats is missing visible export column "revenue"',
    );
    try {
      parseExportFormattingConfig(
        formatting({
          useFormattedValues: true,
          visibleColumns: ['revenue'],
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: REPORT_CONTEXT,
            resolvedFormats: [],
          },
        }),
      );
      throw new Error('Expected snapshot validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_presentation_execution_snapshot',
        deliveryBlocking: true,
      });
    }

    expect(
      parseExportFormattingConfig(
        formatting({
          useFormattedValues: true,
          visibleColumns: ['revenue'],
          presentationExecutionSnapshot: {
            version: 1,
            reportContext: REPORT_CONTEXT,
            resolvedFormats: [
              resolvedColumnFormat('dashboard-1', 'card-1', 'revenue'),
            ],
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        visibleColumns: ['revenue'],
        presentationExecutionSnapshot: expect.objectContaining({
          resolvedFormats: [
            expect.objectContaining({
              target: { kind: 'column', columnKey: 'revenue' },
            }),
          ],
        }),
      }),
    );
  });

  it('accepts a totals label key only when it identifies a visible column', () => {
    expect(
      parseExportFormattingConfig(
        formatting({
          visibleColumns: ['region', 'revenue'],
          tableTotalsLabelColumnKey: 'region',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        visibleColumns: ['region', 'revenue'],
        tableTotalsLabelColumnKey: 'region',
      }),
    );

    expect(() =>
      parseExportFormattingConfig(
        formatting({
          visibleColumns: ['revenue'],
          tableTotalsLabelColumnKey: 'region',
        }),
      ),
    ).toThrow(
      'formatting.tableTotalsLabelColumnKey must identify a visible column',
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
