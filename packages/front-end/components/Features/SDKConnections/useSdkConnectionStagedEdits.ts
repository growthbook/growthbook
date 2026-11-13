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

// The edits, and what each was made against: a setting someone else saves
// meanwhile then shows as a conflict, not as something to overwrite.
type Staged = { patch: Patch; base: Record<string, unknown> };
const NOTHING_STAGED: Staged = { patch: {}, base: {} };

// Edits made in place, held for the session until saved or discarded: one
// set per connection and per revision they were made on.
export function useSdkConnectionStagedEdits(
  // Until it loads, there's nothing to edit.
  connection: SDKConnectionInterface | undefined,
  // The viewed revision's id, or null for live.
  revisionId: string | null,
) {
  const [{ patch, base }, setStaged, clear] = useSessionStagedState<Staged>(
    connection
      ? `gb-sdk-connection-staged:${connection.id}:${revisionId ?? "live"}`
      : null,
    NOTHING_STAGED,
  );
  if (!connection) return null;
  const saved = valueFromConnection(connection);
  const savedValue = (field: string) =>
    (saved as Record<string, unknown>)[field] ?? null;
  const shown: SDKConnectionFormValue = { ...saved, ...patch };
  const fieldsOf = (row: SettingRow) => rowFields(row, shown);
  const stagedRows: SettingRow[] = [
    ...CONNECTION_ROWS,
    ...SECURITY_ROWS,
    ...PAYLOAD_ROWS,
  ].filter((row) => fieldsOf(row).some((field) => field in patch));

  // An edit keeps the base of its first change.
  const restage = (prev: Staged, next: Patch): Staged => ({
    patch: next,
    base: Object.fromEntries(
      Object.keys(next).map((key) => [
        key,
        key in prev.base ? prev.base[key] : savedValue(key),
      ]),
    ),
  });
  // Saved by someone else since, to something other than this edit.
  const conflicted = (field: string) =>
    field in patch &&
    field in base &&
    !isEqual(base[field] ?? null, savedValue(field)) &&
    !isEqual(
      (patch as Record<string, unknown>)[field] ?? null,
      savedValue(field),
    );

  return {
    saved,
    shown,
    // The form as the staged edits found it.
    based: { ...saved, ...base } as SDKConnectionFormValue,
    dirty: Object.keys(patch).length > 0,
    stagedRows,
    fieldsOf,
    // Someone else saved a change to one of its settings since it was edited.
    conflicts: (row: SettingRow) => fieldsOf(row).some(conflicted),
    hasConflicts: Object.keys(patch).some(conflicted),
    // Takes what's saved now as the edit's base, so saving it overwrites.
    keepMine: (row: SettingRow) =>
      setStaged((prev) => ({
        ...prev,
        base: {
          ...prev.base,
          ...Object.fromEntries(
            fieldsOf(row)
              .filter((field) => field in prev.patch)
              .map((field) => [field, savedValue(field)]),
          ),
        },
      })),
    stage: (change: Patch) =>
      setStaged((prev) =>
        restage(prev, diff({ ...saved, ...prev.patch, ...change }, saved)),
      ),
    discardRow: (row: SettingRow) =>
      setStaged((prev) =>
        restage(
          prev,
          diff({ ...saved, ...omit(prev.patch, fieldsOf(row)) }, saved),
        ),
      ),
    clear,
  };
}

export type SdkConnectionStagedEdits = NonNullable<
  ReturnType<typeof useSdkConnectionStagedEdits>
>;
