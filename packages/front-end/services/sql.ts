import { TestQueryRow } from "shared/types/integrations";

export function convertToCSV(rows: TestQueryRow[]): string {
  if (!rows.length) return "";

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","), // header row
    ...rows.map((row) =>
      headers
        .map((field) => {
          const value = row[field];
          if (value == null) return ""; // null or undefined

          // Handle arrays - just stringify the whole array
          if (Array.isArray(value)) {
            try {
              const arrayStr = JSON.stringify(value);
              return `"${arrayStr.replace(/"/g, '""')}"`;
            } catch (error) {
              // Fallback if JSON.stringify fails
              const fallbackStr = String(value).replace(/"/g, '""');
              return `"${fallbackStr}"`;
            }
          }

          // Handle objects (including JSON/JSONB, nested objects, and geographic data)
          if (typeof value === "object" && value !== null) {
            return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
          }

          // Handle dates and timestamps
          if (value instanceof Date) {
            return `"${value.toISOString()}"`;
          }

          // Handle booleans
          if (typeof value === "boolean") {
            return `"${value}"`;
          }

          // Handle numbers (including BigInt)
          if (typeof value === "number" || typeof value === "bigint") {
            return `"${value}"`;
          }

          // Handle binary data (convert to base64)
          if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
            const binaryStr = btoa(
              String.fromCharCode.apply(null, new Uint8Array(value)),
            );
            return `"${binaryStr}"`;
          }

          // Default case: handle as string
          const escaped = String(value).replace(/"/g, '""'); // escape double quotes
          return `"${escaped}"`; // quote everything
        })
        .join(","),
    ),
  ].join("\n");

  return csv;
}

export function downloadCSVFile(csv: string, filename: string = "results.csv") {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
