# Shared Formatter Sync Documentation

This directory contains vendored copies of formatting utilities from `react-semaphor`.
These files must be kept in sync to ensure frontend and Lambda exports produce identical output.

## Why Vendored?

Due to module resolution issues, we cannot directly import `react-semaphor` in the Lambda environment.
Instead, we maintain exact copies of the formatting utilities here inside `chunk-processor/shared/`.

## File Mapping

| Local File | Source File (react-semaphor) | Last Synced |
|------------|------------------------------|-------------|
| `format-utils/types.ts` | `src/shared/format-utils/types/format-types.ts` | 2026-05-16 |
| `format-utils/date-formatter.ts` | `src/shared/format-utils/formatters/date-formatter.ts` | 2026-05-16 |
| `format-utils/number-formatter.ts` | `src/shared/format-utils/formatters/number-formatter.ts` | 2026-05-16 |
| `format-utils/duration-formatter.ts` | `src/shared/format-utils/formatters/duration-formatter.ts` | 2026-05-16 |
| `format-utils/cell-formatter.ts` | `src/shared/format-utils/formatters/cell-formatter.ts` | 2026-05-16 |
| `format-utils/index.ts` | `src/shared/format-utils/index.ts` (subset) | 2026-05-16 |

## Key Functions

### date-formatter.ts
- `formatDate(dateString, formatPattern, displayTimezone?, sourceTimezone?)` - Core date formatting
- `formatRelativeTime(dateString, sourceTimezone?)` - "2 days ago" style
- `parseWithSourceTimezone(dateString, sourceTimezone?)` - Parse with TZ interpretation
- `resolveTimezone(columnTimezone, contextTimezone)` - TZ resolution priority
- `getTimezoneAbbreviation(timezone, date?)` - Get "EST", "PST" etc.

### number-formatter.ts
- `formatNumberWithColumnSettings(value, numberFormat, locale)` - Format with column settings
- `formatNumber(value, options)` - Basic number formatting
- `formatCurrency(value, options)` - Currency formatting
- `formatPercent(value, options)` - Percentage formatting

### duration-formatter.ts
- `formatDuration(value, options)` - Format numeric elapsed durations, e.g. `392` seconds as `6min 32s`

### cell-formatter.ts
- `formatCellValue(value, columnSettings, config)` - Format any cell value
- `formatRowForExport(row, config)` - Format entire row for export

### types.ts
- `ColumnSettings` - Per-column formatting configuration
- `ExportFormattingConfig` - Export-wide formatting configuration
- `DateFormatOptions` - Date formatting options
- `NumberFormatOptions` - Number formatting options

## Local Modifications

No local modifications are currently required in `shared/format-utils`.

Note: fallback behavior for missing number-format locale is handled in
`chunk-processor/lib/formatter.ts` when adapting local column settings.

## Syncing Process

When updating react-semaphor formatting utilities:

1. **Check for changes** in the source files listed above
2. **Copy the changes** to the corresponding local files
3. **Adjust imports** - Local files use `./types` instead of `../types`
4. **Update the "Last Synced" date** in the table above
5. **Run tests** to verify formatting still works correctly

## Dependencies

The formatting utilities require these npm packages:
- `date-fns` (v3.x)
- `date-fns-tz` (v3.x)

Ensure these are installed in the Lambda package:
```bash
cd chunk-processor
npm install date-fns date-fns-tz
```

## Usage in Lambda

```typescript
import { formatCellValue, formatDate } from '../shared/format-utils';

// Format a single cell
const formatted = formatCellValue(value, columnSettings, {
  useFormattedValues: true,
  timezone: 'America/Chicago',
  locale: 'en-US',
});

// Format a date directly
const dateStr = formatDate('2026-05-16T10:30:00Z', 'MM/dd/yyyy', 'America/Chicago');
```

## Testing Alignment

To verify frontend and Lambda produce identical output:

1. Export a table from the frontend
2. Request the same export via Lambda
3. Compare the formatted values - they should match exactly
