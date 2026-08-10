import {
  formatRowsForExport,
  formatRowsForExportWithEvidence,
  generateCSV,
} from './formatter';
import type { ColumnInfo, ExportFormattingConfig } from '../types';
import type { NumericCanonicalFormat } from 'react-semaphor/format-utils';

describe('formatter', () => {
  const defaultFormatting: ExportFormattingConfig = {
    scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
    timezone: 'UTC',
    presentationExecutionSnapshot: {
      version: 1,
      reportContext: {
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
      },
      resolvedFormats: [],
    },
    delimiter: ',',
    includeHeaders: true,
  };

  function withNumericFormat(
    columnKey: string,
    format: NumericCanonicalFormat,
  ): ExportFormattingConfig {
    return {
      ...defaultFormatting,
      presentationExecutionSnapshot: {
        ...defaultFormatting.presentationExecutionSnapshot,
        resolvedFormats: [
          {
            scope: {
              dashboardId: 'dashboard-1',
              cardId: 'card-1',
            },
            target: { kind: 'column', columnKey },
            format,
          },
        ],
      },
    };
  }

  function withTemporalFormat(
    useFormattedValues: boolean,
    columnKey = 'Created month',
  ): ExportFormattingConfig {
    return {
      ...defaultFormatting,
      useFormattedValues,
      visibleColumns: [columnKey],
      presentationExecutionSnapshot: {
        ...defaultFormatting.presentationExecutionSnapshot,
        resolvedFormats: [
          {
            scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
            target: { kind: 'column', columnKey },
            format: {
              type: 'temporal_bucket',
              presentation: {
                mode: 'auto',
                styles: {
                  dateStyle: 'short',
                  dateTime: { dateStyle: 'short', timeStyle: 'short' },
                },
              },
              locale: 'fr-FR',
            },
          },
        ],
      },
    };
  }

  function withRawTemporalFormat(
    useFormattedValues: boolean,
    columnKey = 'occurred_at',
  ): ExportFormattingConfig {
    return {
      ...defaultFormatting,
      useFormattedValues,
      visibleColumns: [columnKey],
      presentationExecutionSnapshot: {
        ...defaultFormatting.presentationExecutionSnapshot,
        resolvedFormats: [
          {
            scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
            target: { kind: 'column', columnKey },
            format: {
              type: 'raw_temporal',
              locale: 'en-US',
              calendarTimezone: 'UTC',
              presentation: {
                mode: 'pattern',
                pattern: 'MMM DD, YYYY',
                dialect: 'semaphor_tokens',
              },
            },
          },
        ],
      },
    };
  }

  describe('formatRowsForExport', () => {
    it('characterizes current explicit date settings in worker CSV', () => {
      const formatting: ExportFormattingConfig = {
        ...defaultFormatting,
        useFormattedValues: true,
        columnSettings: {
          occurred_at: {
            dateFormat: {
              format: 'MM/dd/yyyy',
              useCustomFormat: false,
              customFormat: '',
              timezone: 'UTC',
              sourceTimezone: 'UTC',
            },
          },
        },
      };

      expect(
        formatRowsForExport(
          [{ occurred_at: '2026-08-09T14:30:00.000Z' }],
          [{ key: 'occurred_at', field: 'occurred_at' }],
          formatting,
        ),
      ).toEqual([['08/09/2026']]);
    });

    it('formats config-owned raw temporal values from metadata and the captured snapshot', () => {
      const columns: ColumnInfo[] = [
        {
          key: 'occurred_at',
          field: 'occurred_at',
          dataType: 'date',
          rawTemporal: {
            kind: 'raw_temporal',
            valueKind: 'date',
          },
        },
      ];

      expect(
        formatRowsForExport(
          [{ occurred_at: '2026-08-09' }, { occurred_at: null }],
          columns,
          withRawTemporalFormat(true),
        ),
      ).toEqual([['Aug 09, 2026'], ['']]);
      expect(
        formatRowsForExport(
          [{ occurred_at: '2026-08-09' }, { occurred_at: null }],
          columns,
          withRawTemporalFormat(false),
        ),
      ).toEqual([['2026-08-09'], ['']]);
    });

    it('keeps a pre-query config candidate inert without transported metadata', () => {
      expect(
        formatRowsForExport(
          [{ occurred_at: '2026-08-09' }],
          [{ key: 'occurred_at', field: 'occurred_at', dataType: 'date' }],
          withRawTemporalFormat(true),
          {
            queryPayload: {
              cardType: 'detailTable',
              resultOwner: 'config',
              sql: '',
              python: '',
            },
          },
        ),
      ).toEqual([['2026-08-09']]);
    });

    it('classifies declared SQL temporal columns and returns durable chunk evidence', () => {
      const result = formatRowsForExportWithEvidence(
        [
          { occurred_at: '2026-08-09T14:30:00Z' },
          { occurred_at: 'not-a-date' },
        ],
        [{ key: 'occurred_at', field: 'occurred_at' }],
        withRawTemporalFormat(true),
        {
          queryPayload: {
            cardType: 'table',
            resultOwner: 'freeform',
            sql: 'select occurred_at from events',
            python: '',
          },
        },
      );

      expect(result.rows).toEqual([['Aug 09, 2026'], ['not-a-date']]);
      expect(result.rawTemporalClassification).toEqual({
        version: 1,
        columns: { occurred_at: 'instant' },
      });
    });

    it('keeps formatting-disabled SQL output raw without classification evidence', () => {
      const result = formatRowsForExportWithEvidence(
        [{ occurred_at: '2026-08-09T14:30:00Z' }],
        [{ key: 'occurred_at', field: 'occurred_at' }],
        withRawTemporalFormat(false),
        {
          queryPayload: {
            cardType: 'table',
            resultOwner: 'freeform',
            sql: 'select occurred_at from events',
            python: '',
          },
        },
      );

      expect(result.rows).toEqual([['2026-08-09T14:30:00Z']]);
      expect(result.rawTemporalClassification).toBeUndefined();
    });

    it('fails a declared SQL chunk that mixes temporal meanings', () => {
      expect(() =>
        formatRowsForExportWithEvidence(
          [
            { occurred_at: '2026-08-09' },
            { occurred_at: '2026-08-09T14:30:00Z' },
          ],
          [{ key: 'occurred_at', field: 'occurred_at' }],
          withRawTemporalFormat(true),
          {
            queryPayload: {
              cardType: 'table',
              resultOwner: 'freeform',
              sql: 'select occurred_at from events',
              python: '',
            },
          },
        ),
      ).toThrow('mixes date, wall-datetime, or instant semantics');
    });

    it('formats canonical temporal buckets from metadata and the captured snapshot', () => {
      const columns: ColumnInfo[] = [
        {
          key: 'Created month',
          field: 'Created month',
          label: 'Created month',
          temporalBucket: {
            kind: 'temporal_bucket',
            granularity: 'month',
            calendar: { tz: 'UTC', weekStart: 1 },
          },
        },
      ];

      expect(
        formatRowsForExport(
          [{ 'Created month': '2026-07-01' }, { 'Created month': null }],
          columns,
          withTemporalFormat(true),
        ),
      ).toEqual([['07/2026'], ['(Blank)']]);
      expect(
        formatRowsForExport(
          [{ 'Created month': '2026-07-01' }, { 'Created month': null }],
          columns,
          withTemporalFormat(false),
        ),
      ).toEqual([['2026-07-01'], ['']]);
    });

    it('keeps labeled canonical subtotal metadata on its stable raw output key', () => {
      const columns: ColumnInfo[] = [
        {
          key: 'orders_created_at',
          temporalBucket: {
            kind: 'temporal_bucket',
            granularity: 'month',
            calendar: { tz: 'UTC', weekStart: 1 },
          },
        },
        { key: 'revenue' },
      ];
      const formatting = {
        ...withTemporalFormat(true, 'orders_created_at'),
        visibleColumns: ['orders_created_at', 'revenue'],
      };
      const queryPayload = {
        cardType: 'aggregateTable',
        cardConfig: {
          groupByColumns: [
            {
              id: 'created-month-id',
              name: 'created_at',
              label: 'Created month',
            },
          ],
          rowAggregates: [
            {
              function: 'SUM',
              groupLevel: 'created-month-id',
              label: 'Monthly subtotal',
            },
            { function: 'SUM', groupLevel: 'ALL' },
          ],
        },
      };

      expect(
        formatRowsForExport(
          [
            {
              orders_created_at: null,
              revenue: 10,
              isSubtotal: true,
              subtotalLevel: 'orders_created_at',
              subtotalContext: {
                groupByValues: { orders_created_at: '2026-07-01' },
              },
              aggregate: 'SUM',
            },
            {
              orders_created_at: null,
              revenue: 10,
              isGrandTotal: true,
              aggregate: 'SUM',
            },
          ],
          columns,
          formatting,
          {
            queryPayload,
            columnKeyMap: {
              version: 1,
              source: 'explorer',
              byRole: {
                groupby: {
                  'created-month-id': {
                    role: 'groupby',
                    rawKey: 'orders_created_at',
                    outputKey: 'orders_created_at',
                  },
                },
              },
            },
          },
        ),
      ).toEqual([
        ['Monthly subtotal', '10'],
        ['Grand Total', '10'],
      ]);
    });

    it('preserves a blank temporal parent on a deeper aggregate subtotal', () => {
      const formatting = {
        ...withTemporalFormat(true, 'orders_created_at'),
        visibleColumns: ['orders_created_at', 'orders_region', 'revenue'],
      };

      expect(
        formatRowsForExport(
          [
            {
              orders_created_at: null,
              orders_region: 'West',
              revenue: 10,
              isSubtotal: true,
              subtotalLevel: 'orders_region',
              subtotalContext: {
                groupByValues: {
                  orders_created_at: null,
                  orders_region: 'West',
                },
              },
              aggregate: 'SUM',
            },
          ],
          [
            {
              key: 'orders_created_at',
              temporalBucket: {
                kind: 'temporal_bucket',
                granularity: 'month',
                calendar: { tz: 'UTC', weekStart: 1 },
              },
            },
            { key: 'orders_region' },
            { key: 'revenue' },
          ],
          formatting,
          {
            queryPayload: {
              cardType: 'aggregateTable',
              cardConfig: {
                groupByColumns: [
                  { id: 'created-month-id', name: 'created_at' },
                  { id: 'region-id', name: 'region' },
                ],
                rowAggregates: [
                  {
                    function: 'SUM',
                    groupLevel: 'region-id',
                  },
                ],
              },
            },
            columnKeyMap: {
              version: 1,
              source: 'explorer',
              byRole: {
                groupby: {
                  'created-month-id': {
                    role: 'groupby',
                    rawKey: 'orders_created_at',
                  },
                  'region-id': {
                    role: 'groupby',
                    rawKey: 'orders_region',
                  },
                },
              },
            },
          },
        ),
      ).toEqual([['(Blank)', 'Subtotal (West)', '10']]);
    });

    it('does not format a hidden temporal parent before a visible subtotal', () => {
      expect(
        formatRowsForExport(
          [
            {
              orders_created_at: null,
              orders_region: 'West',
              revenue: 10,
              isSubtotal: true,
              subtotalLevel: 'orders_region',
              subtotalContext: {
                groupByValues: {
                  orders_created_at: '2026-07-01',
                  orders_region: 'West',
                },
              },
              aggregate: 'SUM',
            },
          ],
          [
            {
              key: 'orders_created_at',
              temporalBucket: {
                kind: 'temporal_bucket',
                granularity: 'month',
                calendar: { tz: 'UTC', weekStart: 1 },
              },
            },
            { key: 'orders_region' },
            { key: 'revenue' },
          ],
          {
            ...defaultFormatting,
            useFormattedValues: true,
            visibleColumns: ['orders_region', 'revenue'],
          },
          {
            queryPayload: {
              cardType: 'aggregateTable',
              cardConfig: {
                groupByColumns: [
                  { id: 'created-month-id', name: 'created_at' },
                  { id: 'region-id', name: 'region' },
                ],
                rowAggregates: [{ function: 'SUM', groupLevel: 'region-id' }],
              },
            },
            columnKeyMap: {
              version: 1,
              source: 'explorer',
              byRole: {
                groupby: {
                  'created-month-id': {
                    role: 'groupby',
                    rawKey: 'orders_created_at',
                  },
                  'region-id': {
                    role: 'groupby',
                    rawKey: 'orders_region',
                  },
                },
              },
            },
          },
        ),
      ).toEqual([['Subtotal (West)', '10']]);
    });

    it('does not apply aggregate presentation without canonical temporal metadata', () => {
      expect(
        formatRowsForExport(
          [
            {
              region: 'raw sql value',
              isSubtotal: true,
              subtotalLevel: 'region',
              subtotalContext: { groupByValues: { region: 'West' } },
            },
          ],
          [{ key: 'region' }],
          {
            ...defaultFormatting,
            useFormattedValues: true,
            visibleColumns: ['region'],
          },
          {
            queryPayload: {
              cardType: 'aggregateTable',
              sql: 'select region, isSubtotal from custom_result',
              cardConfig: {
                groupByColumns: [{ id: 'region-id', name: 'region' }],
                rowAggregates: [
                  {
                    function: 'SUM',
                    groupLevel: 'region-id',
                    label: 'Configured subtotal',
                  },
                ],
              },
            },
            columnKeyMap: {
              version: 1,
              source: 'explorer',
              byRole: {
                groupby: {
                  'region-id': { role: 'groupby', rawKey: 'region' },
                },
              },
            },
          },
        ),
      ).toEqual([['raw sql value']]);
    });

    it('accepts metric-only aggregate tables without group columns', () => {
      expect(
        formatRowsForExport(
          [{ revenue: 10 }],
          [{ key: 'revenue' }],
          {
            ...defaultFormatting,
            visibleColumns: ['revenue'],
          },
          {
            queryPayload: {
              cardType: 'aggregateTable',
              cardConfig: { metricColumns: [{ id: 'revenue' }] },
            },
          },
        ),
      ).toEqual([['10']]);
    });

    it('revalidates captured presentation against authoritative result metadata', () => {
      const formatting = withTemporalFormat(true);
      formatting.presentationExecutionSnapshot.resolvedFormats = [
        {
          scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
          target: { kind: 'column', columnKey: 'Created month' },
          format: {
            type: 'temporal_bucket',
            presentation: {
              mode: 'preset',
              preset: 'fiscal_year',
            },
            locale: 'en-US',
          },
        },
      ];

      expect(
        formatRowsForExport(
          [{ 'Created month': '2026-01-01' }],
          [
            {
              key: 'Created month',
              temporalBucket: {
                kind: 'temporal_bucket',
                granularity: 'year',
                calendar: { tz: 'UTC', weekStart: 1 },
              },
            },
          ],
          formatting,
        ),
      ).toEqual([['2026']]);
    });

    it('rejects formatted temporal delivery without its captured format', () => {
      expect(() =>
        formatRowsForExport(
          [{ 'Created month': '2026-07-01' }],
          [
            {
              key: 'Created month',
              temporalBucket: {
                kind: 'temporal_bucket',
                granularity: 'month',
                calendar: { tz: 'UTC', weekStart: 1 },
              },
            },
          ],
          {
            ...defaultFormatting,
            useFormattedValues: true,
            visibleColumns: ['Created month'],
          },
        ),
      ).toThrow('Missing resolved temporal presentation');
    });

    it('rejects a captured temporal format without result metadata', () => {
      expect(() =>
        formatRowsForExport(
          [{ 'Created month': '2026-07-01' }],
          [{ key: 'Created month' }],
          withTemporalFormat(true),
        ),
      ).toThrow('Missing temporal bucket metadata');
    });

    it('does not require temporal metadata for raw CSV', () => {
      expect(
        formatRowsForExport(
          [{ 'Created month': '2026-07-01' }],
          [{ key: 'Created month' }],
          withTemporalFormat(false),
        ),
      ).toEqual([['2026-07-01']]);
    });

    it('should format rows with columns from API', () => {
      const data = [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
      ];
      const columns: ColumnInfo[] = [
        { field: 'name', headerName: 'Name' },
        { field: 'age', headerName: 'Age' },
        { field: 'city', headerName: 'City' },
      ];

      const result = formatRowsForExport(
        data,
        columns,
        withNumericFormat('value', {
          type: 'number',
          locale: 'en-US',
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
        }),
      );

      expect(result).toEqual([
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ]);
    });

    it('should format rows with visibleColumns from formatting', () => {
      const data = [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
      ];
      const columns: ColumnInfo[] = [
        { field: 'name', headerName: 'Name' },
        { field: 'age', headerName: 'Age' },
        { field: 'city', headerName: 'City' },
      ];
      const formatting: ExportFormattingConfig = {
        ...defaultFormatting,
        visibleColumns: ['name', 'city'], // Only name and city, no age
      };

      const result = formatRowsForExport(data, columns, formatting);

      expect(result).toEqual([
        ['Alice', 'NYC'],
        ['Bob', 'LA'],
      ]);
    });

    it('should derive columns from first record when columns array is empty', () => {
      const data = [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
      ];
      const columns: ColumnInfo[] = []; // Empty columns - simulating API not returning columns

      const result = formatRowsForExport(data, columns, defaultFormatting);

      // Should derive columns from Object.keys(data[0])
      expect(result).toEqual([
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ]);
    });

    it('should handle null and undefined values', () => {
      const data = [
        { name: 'Alice', age: null, city: undefined },
        { name: null, age: 25, city: 'LA' },
      ];
      const columns: ColumnInfo[] = [
        { field: 'name' },
        { field: 'age' },
        { field: 'city' },
      ];

      const result = formatRowsForExport(data, columns, defaultFormatting);

      expect(result).toEqual([
        ['Alice', '', ''],
        ['', '25', 'LA'],
      ]);
    });

    it('should return empty arrays when no data and no columns', () => {
      const result = formatRowsForExport([], [], defaultFormatting);
      expect(result).toEqual([]);
    });

    it('preserves raw numbers when no canonical format was carried', () => {
      const data = [{ value: 1234.5678 }];
      const columns: ColumnInfo[] = [{ field: 'value' }];

      const result = formatRowsForExport(data, columns, defaultFormatting);

      expect(result[0][0]).toBe('1234.5678');
    });

    it('formats currency only from the carried canonical column format', () => {
      const data = [{ price: 1234.5 }];
      const columns: ColumnInfo[] = [{ field: 'price' }];
      const formatting = withNumericFormat('price', {
        type: 'currency',
        locale: 'en-US',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const result = formatRowsForExport(data, columns, formatting);

      expect(result[0][0]).toBe('$1,234.50');
    });

    it('formats whole percents from the carried canonical column format', () => {
      const data = [{ rate: 75 }]; // 75%
      const columns: ColumnInfo[] = [{ field: 'rate' }];
      const formatting = withNumericFormat('rate', {
        type: 'percent',
        locale: 'en-US',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        percentValueMode: 'whole',
      });

      const result = formatRowsForExport(data, columns, formatting);

      expect(result[0][0]).toBe('75%');
    });

    it('preserves percentValueMode=fraction from the carried format', () => {
      const data = [{ rate: 0.125 }]; // 12.5% when interpreted as fraction
      const columns: ColumnInfo[] = [{ field: 'rate' }];
      const formatting = withNumericFormat('rate', {
        type: 'percent',
        locale: 'en-US',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        percentValueMode: 'fraction',
      });

      const result = formatRowsForExport(data, columns, formatting);

      expect(result[0][0]).toBe('12.5%');
    });

    it('preserves useGrouping=false from the carried format', () => {
      const data = [{ value: 12345.67 }];
      const columns: ColumnInfo[] = [{ field: 'value' }];
      const formatting = withNumericFormat('value', {
        type: 'number',
        locale: 'en-US',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: false,
      });

      const result = formatRowsForExport(data, columns, formatting);

      expect(result[0][0]).toBe('12345.67');
    });
  });

  it('formats producer-aligned temporal wide-pivot members in async CSV headers', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      useFormattedValues: true,
      visibleColumns: ['revenue_july'],
      columnLabels: { revenue_july: 'Revenue Current' },
      presentationExecutionSnapshot: {
        ...defaultFormatting.presentationExecutionSnapshot,
        resolvedFormats: [
          {
            scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
            target: {
              kind: 'field',
              fieldId: 'created-month',
              role: 'groupby',
            },
            format: {
              type: 'temporal_bucket',
              presentation: { mode: 'pattern', pattern: 'YYYY' },
              locale: 'en-US',
            },
          },
          {
            scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
            target: {
              kind: 'field',
              fieldId: 'created-month',
              role: 'pivotby',
            },
            format: {
              type: 'temporal_bucket',
              presentation: {
                mode: 'auto',
                styles: {
                  dateStyle: 'short',
                  dateTime: { dateStyle: 'short', timeStyle: 'short' },
                },
              },
              locale: 'fr-FR',
            },
          },
        ],
      },
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        label: 'Revenue',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [
            {
              fieldId: 'created-month',
              value: '2026-07-01',
              temporalBucket: {
                kind: 'temporal_bucket',
                granularity: 'month',
                calendar: { tz: 'UTC', weekStart: 1 },
              },
            },
          ],
        },
      },
    ];

    expect(
      generateCSV([['10']], columns, formatting, { includeHeaders: true }),
    ).toBe('07/2026 / Revenue Current\n10\n');
  });

  it('preserves canonical pivot members in raw async CSV headers', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      useFormattedValues: false,
      visibleColumns: ['revenue_july', 'revenue_august'],
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        label: 'Revenue',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [{ fieldId: 'created-month', value: '2026-07-01' }],
        },
      },
      {
        key: 'revenue_august',
        label: 'Revenue',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [{ fieldId: 'created-month', value: '2026-08-01' }],
        },
      },
    ];

    expect(
      generateCSV([['10', '20']], columns, formatting, {
        includeHeaders: true,
      }),
    ).toBe('2026-07-01 / Revenue,2026-08-01 / Revenue\n10,20\n');
  });

  it('fails closed when a physical pivot column omits member identity', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      useFormattedValues: false,
      visibleColumns: ['revenue_july'],
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        label: 'Revenue',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: undefined as any,
        },
      },
    ];

    expect(() =>
      generateCSV([['10']], columns, formatting, { includeHeaders: true }),
    ).toThrow('missing_pivot_member_identity');
  });

  it('fails closed when a pivot member lacks stable field identity', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      visibleColumns: ['revenue_july'],
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [{ fieldId: '', value: '2026-08-01' }],
        },
      },
    ];

    expect(() =>
      generateCSV([['10']], columns, formatting, { includeHeaders: true }),
    ).toThrow('invalid identity');
  });

  it('validates pivot identity even when CSV headers are disabled', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      visibleColumns: ['revenue_july'],
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: undefined as any,
        },
      },
    ];

    expect(() =>
      generateCSV([['10']], columns, formatting, { includeHeaders: false }),
    ).toThrow('missing_pivot_member_identity');
  });

  it('validates hidden pivot identities against authored axis order', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      visibleColumns: ['revenue_july'],
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [
            { fieldId: 'month', value: '2026-07-01' },
            { fieldId: 'region', value: 'East' },
          ],
        },
      },
      {
        key: 'hidden_revenue',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [{ fieldId: 'region', value: 'West' }],
        },
      },
    ];

    expect(() =>
      formatRowsForExport(
        [{ revenue_july: 10, hidden_revenue: 20 }],
        columns,
        formatting,
        {
          queryPayload: {
            cardType: 'pivotTable',
            cardConfig: {
              pivotByColumns: [{ id: 'month' }, { id: 'region' }],
            },
          },
        },
      ),
    ).toThrow('expected "month"');
  });

  it('rejects a partial ordinary leaf from the production query payload', () => {
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [{ fieldId: 'month', value: '2026-07-01' }],
        },
      },
    ];

    expect(() =>
      formatRowsForExport(
        [{ revenue_july: 10 }],
        columns,
        { ...defaultFormatting, visibleColumns: ['revenue_july'] },
        {
          queryPayload: {
            cardType: 'pivotTable',
            cardConfig: {
              pivotByColumns: [{ id: 'month' }, { id: 'region' }],
            },
          },
        },
      ),
    ).toThrow('expected 2');
  });

  it('accepts a partial tuple only for an explicit pivot subtotal', () => {
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_july_subtotal',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [{ fieldId: 'month', value: '2026-07-01' }],
        },
      },
    ];

    expect(() =>
      formatRowsForExport(
        [{ revenue_july_subtotal: 10 }],
        columns,
        {
          ...defaultFormatting,
          visibleColumns: ['revenue_july_subtotal'],
        },
        {
          queryPayload: {
            cardType: 'pivotTable',
            cardConfig: {
              pivotByColumns: [{ id: 'month' }, { id: 'region' }],
            },
          },
          columnMetadata: {
            revenue_july_subtotal: {
              isSubtotal: true,
              subtotalScope: 'pivot-value',
            },
          },
        },
      ),
    ).not.toThrow();
  });

  it('accepts an empty tuple with pivot axes only for an explicit grand total', () => {
    const columns: ColumnInfo[] = [
      {
        key: 'revenue_total',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [],
        },
      },
    ];
    const context = {
      queryPayload: {
        cardType: 'pivotTable',
        cardConfig: {
          pivotByColumns: [{ id: 'month' }, { id: 'region' }],
        },
      },
    };

    expect(() =>
      formatRowsForExport(
        [{ revenue_total: 10 }],
        columns,
        { ...defaultFormatting, visibleColumns: ['revenue_total'] },
        context,
      ),
    ).toThrow('missing its required pivot tuple');

    expect(() =>
      formatRowsForExport(
        [{ revenue_total: 10 }],
        columns,
        { ...defaultFormatting, visibleColumns: ['revenue_total'] },
        {
          ...context,
          columnMetadata: {
            revenue_total: {
              isSubtotal: true,
              subtotalScope: 'grand-total',
            },
          },
        },
      ),
    ).not.toThrow();
  });

  it('accepts an empty member tuple for a metric-only column', () => {
    const formatting: ExportFormattingConfig = {
      ...defaultFormatting,
      visibleColumns: ['revenue'],
    };
    const columns: ColumnInfo[] = [
      {
        key: 'revenue',
        pivotIdentity: {
          metricId: 'revenue',
          metricAlias: 'revenue_sum',
          members: [],
        },
      },
    ];

    const rows = formatRowsForExport([{ revenue: 10 }], columns, formatting, {
      queryPayload: {
        cardType: 'pivotTable',
        cardConfig: { pivotByColumns: [] },
      },
    });
    expect(
      generateCSV(rows, columns, formatting, { includeHeaders: false }),
    ).toBe('10\n');
  });

  describe('generateCSV', () => {
    it('should generate CSV with headers', () => {
      const data = [
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ];
      const columns: ColumnInfo[] = [
        { field: 'name', headerName: 'Name' },
        { field: 'age', headerName: 'Age' },
        { field: 'city', headerName: 'City' },
      ];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: true,
      });

      expect(result).toBe('Name,Age,City\nAlice,30,NYC\nBob,25,LA\n');
    });

    it('uses canonical comparison column labels supplied by the query client', () => {
      const formatting = {
        ...defaultFormatting,
        visibleColumns: ['Sales', 'comparison_sales'],
        columnLabels: {
          comparison_sales: 'Sales (Previous Period)',
        },
      };
      const result = generateCSV([['120', '100']], [], formatting, {
        includeHeaders: true,
      });
      expect(result).toBe('Sales,Sales (Previous Period)\n120,100\n');
    });

    it('uses only own string properties from a partial column-label map', () => {
      const formatting: ExportFormattingConfig = {
        ...defaultFormatting,
        visibleColumns: ['constructor', 'toString', 'valueOf'],
        columnLabels: {
          toString: 'String value',
        },
      };
      const columns: ColumnInfo[] = [
        { field: 'constructor', headerName: 'Constructor value' },
      ];

      const result = generateCSV(
        [['first', 'second', 'third']],
        columns,
        formatting,
        { includeHeaders: true },
      );

      expect(result).toBe(
        'Constructor value,String value,valueOf\nfirst,second,third\n',
      );
    });

    it('should generate CSV without headers', () => {
      const data = [
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ];
      const columns: ColumnInfo[] = [
        { field: 'name', headerName: 'Name' },
        { field: 'age', headerName: 'Age' },
        { field: 'city', headerName: 'City' },
      ];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('Alice,30,NYC\nBob,25,LA\n');
    });

    it('should derive headers from rawRecords when columns is empty', () => {
      const data = [
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ];
      const columns: ColumnInfo[] = []; // Empty!
      const rawRecords = [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
      ];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: true,
        rawRecords,
      });

      // Headers derived from Object.keys(rawRecords[0]) = ['name', 'age', 'city']
      expect(result).toBe('name,age,city\nAlice,30,NYC\nBob,25,LA\n');
    });

    it('should escape values containing delimiter', () => {
      const data = [['Hello, World', 'Test']];
      const columns: ColumnInfo[] = [{ field: 'greeting' }, { field: 'test' }];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('"Hello, World",Test\n');
    });

    it('should escape values containing double quotes', () => {
      const data = [['Say "Hello"', 'Test']];
      const columns: ColumnInfo[] = [{ field: 'greeting' }, { field: 'test' }];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('"Say ""Hello""",Test\n');
    });

    it('should escape values containing newlines', () => {
      const data = [['Line1\nLine2', 'Test']];
      const columns: ColumnInfo[] = [{ field: 'multiline' }, { field: 'test' }];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('"Line1\nLine2",Test\n');
    });

    it('should use custom delimiter', () => {
      const data = [['Alice', '30', 'NYC']];
      const columns: ColumnInfo[] = [
        { field: 'name' },
        { field: 'age' },
        { field: 'city' },
      ];
      const formatting: ExportFormattingConfig = {
        ...defaultFormatting,
        delimiter: ';',
      };

      const result = generateCSV(data, columns, formatting, {
        includeHeaders: false,
      });

      expect(result).toBe('Alice;30;NYC\n');
    });

    it('should handle empty data array', () => {
      const columns: ColumnInfo[] = [{ field: 'name', headerName: 'Name' }];

      const result = generateCSV([], columns, defaultFormatting, {
        includeHeaders: true,
      });

      expect(result).toBe('Name\n');
    });

    it('should handle empty data without headers', () => {
      const result = generateCSV([], [], defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('');
    });
  });

  describe('integration: formatRowsForExport + generateCSV', () => {
    it('should produce valid CSV from raw records with empty columns', () => {
      // This is the exact scenario that was failing in production
      const records = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Charlie', email: 'charlie@example.com' },
      ];
      const columns: ColumnInfo[] = []; // Empty - API didn't return columns

      const formattedRows = formatRowsForExport(
        records,
        columns,
        defaultFormatting,
      );
      const csv = generateCSV(formattedRows, columns, defaultFormatting, {
        includeHeaders: true,
        rawRecords: records,
      });

      // Should have headers from Object.keys and actual data, with trailing newline
      const lines = csv.split('\n');
      expect(lines.length).toBe(5); // 1 header + 3 data rows + empty from trailing \n
      expect(lines[0]).toBe('id,name,email');
      expect(lines[1]).toBe('1,Alice,alice@example.com');
      expect(lines[2]).toBe('2,Bob,bob@example.com');
      expect(lines[3]).toBe('3,Charlie,charlie@example.com');
      expect(lines[4]).toBe(''); // trailing newline creates empty element
    });

    it('should NOT produce empty rows (the bug we fixed)', () => {
      const records = [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ];
      const columns: ColumnInfo[] = [];

      const formattedRows = formatRowsForExport(
        records,
        columns,
        defaultFormatting,
      );

      // Each row should have 2 values, not be empty
      expect(formattedRows[0].length).toBe(2);
      expect(formattedRows[1].length).toBe(2);

      // Values should be the actual data
      expect(formattedRows[0]).toEqual(['1', '2']);
      expect(formattedRows[1]).toEqual(['3', '4']);
    });

    it('should end CSV with trailing newline for chunk concatenation', () => {
      // This test ensures chunks concatenate correctly without row merging
      // If chunk1 ends with "row49999" and chunk2 starts with "row50000",
      // they would merge into "row49999row50000" without trailing newlines
      const data = [
        ['Alice', '30'],
        ['Bob', '25'],
      ];
      const columns: ColumnInfo[] = [{ field: 'name' }, { field: 'age' }];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result.endsWith('\n')).toBe(true);

      // Simulate chunk concatenation
      const chunk1 = generateCSV(
        [['Alice', '30']],
        columns,
        defaultFormatting,
        {
          includeHeaders: true,
        },
      );
      const chunk2 = generateCSV([['Bob', '25']], columns, defaultFormatting, {
        includeHeaders: false,
      });

      const concatenated = chunk1 + chunk2;
      const lines = concatenated.split('\n').filter((line) => line.length > 0);

      // Should have 3 lines: header, Alice, Bob (no merged rows)
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('name,age');
      expect(lines[1]).toBe('Alice,30');
      expect(lines[2]).toBe('Bob,25');
    });
  });
});
