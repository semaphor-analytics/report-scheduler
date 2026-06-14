export function formatColumnLabel(column: string): string {
  const labels: Record<string, string> = {
    __semaphor_driver_bucket: "Driver Type",
    current_value: "Current",
    previous_value: "Previous",
    percent_change: "% Change",
    customer_name: "Customer",
    product_name: "Product",
    sub_category: "Subcategory",
  };
  const label = labels[column];
  if (label) {
    return label;
  }

  return column
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatTableCell(column: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    if (/percent|pct|rate/i.test(column)) {
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
        signDisplay: "exceptZero",
      }).format(value);
    }
    if (/delta|change/i.test(column)) {
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
      }).format(value);
    }
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
    }).format(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  const stringValue = String(value);
  return formatIsoLikeDateTime(stringValue) ?? stringValue;
}

export function formatIsoLikeDateTime(value: string): string | undefined {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute] = match;
  if (!year || !month || !day || !hour || !minute) {
    return undefined;
  }

  const date = new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
  );
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
