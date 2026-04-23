import bs58 from "bs58";

export function encodeMetricIdForColumnName(metricId: string): string {
  // We are using ? for slices and that is an invalid character for column names
  // so we encode it.
  // We use base58 because base64 includes charactes that are invalid too
  const parts = metricId.split("?");
  if (parts.length === 2) {
    const encoded = bs58.encode(Buffer.from(parts[1]));
    return `${parts[0]}_${encoded}`;
  }
  return parts[0];
}
