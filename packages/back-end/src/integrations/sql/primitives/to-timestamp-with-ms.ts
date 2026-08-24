export function toTimestampWithMs(date: Date): string {
  return `'${date.toISOString().substring(0, 23).replace("T", " ")}'`;
}
