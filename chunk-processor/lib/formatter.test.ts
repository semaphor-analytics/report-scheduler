import { formatRowsForExport, generateCSV } from './formatter';
import type {
  ColumnInfo,
  ExportFormattingConfig,
} from '../types';
import type { NumericCanonicalFormat } from 'react-semaphor/format-utils';

describe('formatter', () => {
  const defaultFormatting: ExportFormattingConfig = {
    timezone: 'UTC',
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
    resolvedNumericFormats: [],
    delimiter: ',',
    includeHeaders: true,
  };

  function withNumericFormat(
    columnKey: string,
    format: NumericCanonicalFormat,
  ): ExportFormattingConfig {
    return {
      ...defaultFormatting,
      resolvedNumericFormats: [
        {
          scope: {
            dashboardId: 'dashboard-1',
            cardId: 'card-1',
          },
          target: { kind: 'column', columnKey },
          format,
        },
      ],
    };
  }

  describe('formatRowsForExport', () => {
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
      const result = generateCSV(
        [['120', '100']],
        [],
        formatting,
        { includeHeaders: true },
      );
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
      const columns: ColumnInfo[] = [
        { field: 'greeting' },
        { field: 'test' },
      ];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('"Hello, World",Test\n');
    });

    it('should escape values containing double quotes', () => {
      const data = [['Say "Hello"', 'Test']];
      const columns: ColumnInfo[] = [
        { field: 'greeting' },
        { field: 'test' },
      ];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result).toBe('"Say ""Hello""",Test\n');
    });

    it('should escape values containing newlines', () => {
      const data = [['Line1\nLine2', 'Test']];
      const columns: ColumnInfo[] = [
        { field: 'multiline' },
        { field: 'test' },
      ];

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
      const columns: ColumnInfo[] = [
        { field: 'name', headerName: 'Name' },
      ];

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

      const formattedRows = formatRowsForExport(records, columns, defaultFormatting);
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

      const formattedRows = formatRowsForExport(records, columns, defaultFormatting);

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
      const columns: ColumnInfo[] = [
        { field: 'name' },
        { field: 'age' },
      ];

      const result = generateCSV(data, columns, defaultFormatting, {
        includeHeaders: false,
      });

      expect(result.endsWith('\n')).toBe(true);

      // Simulate chunk concatenation
      const chunk1 = generateCSV([['Alice', '30']], columns, defaultFormatting, {
        includeHeaders: true,
      });
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
