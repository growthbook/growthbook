const UTF8_BYTE_ORDER_MARK = "\uFEFF";

/**
 * Removes a UTF-8 BOM if the string starts with one.
 *
 * Editors and exporters sometimes save JSON/text with a UTF-8 byte order mark at
 * the very start of the file. JSON.parse often tolerates it, but other parsers
 * (including Google credential libraries used by Confluent’s BigQuery sink when
 * validating `keyfile`) treat the BOM as invalid input and fail with errors such
 * as “Failed to create credentials from input stream”.
 */
export function stripLeadingUtf8ByteOrderMark(text: string): string {
  return text.startsWith(UTF8_BYTE_ORDER_MARK)
    ? text.slice(UTF8_BYTE_ORDER_MARK.length)
    : text;
}
