import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import useSessionStagedState from "@/hooks/useSessionStagedState";
import {
  SDKConnectionFormValue,
  valueFromConnection,
} from "@/components/Features/SDKConnections/SDKConnectionEditModal";
import {
  CONNECTION_ROWS,
  PAYLOAD_ROWS,
  rowFields,
  SECURITY_ROWS,
  SettingRow,
} from "@/components/Features/SDKConnections/sdkConnectionSettingRows";

type Patch = Partial<SDKConnectionFormValue>;

// Only what differs from what's saved. A plain payload has no cipher options.
function diff(next: SDKConnectionFormValue, saved: SDKConnectionFormValue) {
  if (next.delivery === "plain") {
    next = { ...next, encryptPayload: false, hashSecureAttributes: false };
  }
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof SDKConnectionFormValue)[]) {
    if (!isEqual(next[key], saved[key])) patch[key] = next[key];
  }
  return patch as Patch;
}

// Edits made in place, held for the session until saved or discarded: one
// set per connection and per revision they were made on.
export function useSdkConnectionStagedEdits(
  // Until it loads, there's nothing to edit.
  connection: SDKConnectionInterface | undefined,
  // The viewed revision's id, or null for live.
  revisionId: string | null,
) {
  const [patch, setPatch, clear] = useSessionStagedState<Patch>(
    connection
      ? `gb-sdk-connection-edits:${connection.id}:${revisionId ?? "live"}`
      : null,
    {},
  );
  if (!connection) return null;
  const saved = valueFromConnection(connection);
  const shown: SDKConnectionFormValue = { ...saved, ...patch };
  const fieldsOf = (row: SettingRow) => rowFields(row, shown);
  const stagedRows: SettingRow[] = [
    ...CONNECTION_ROWS,
    ...SECURITY_ROWS,
    ...PAYLOAD_ROWS,
  ].filter((row) => fieldsOf(row).some((field) => field in patch));

  return {
    saved,
    shown,
    dirty: Object.keys(patch).length > 0,
    stagedRows,
    fieldsOf,
    stage: (change: Patch) =>
      setPatch((prev) => diff({ ...saved, ...prev, ...change }, saved)),
    discardRow: (row: SettingRow) =>
      setPatch((prev) =>
        diff({ ...saved, ...omit(prev, fieldsOf(row)) }, saved),
      ),
    clear,
  };
}

export type SdkConnectionStagedEdits = NonNullable<
  ReturnType<typeof useSdkConnectionStagedEdits>
>;
