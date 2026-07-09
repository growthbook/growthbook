import { useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import {
  ExpandableDiff,
  DiffCommentsProps,
  DiffFormatToggle,
  CopyAsButton,
  FormattedChanges,
  useDiffFormat,
  stringifyForRawDiff,
  type DiffFormat,
  type FormattedChangeItem,
} from "@/components/Reviews/Feature/RevisionDiffUtils";
import { capitalizeFirstLetter } from "@/services/utils";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { DiffItem } from "@/components/Revision/useRevisionDiff";
import { diffSectionAnchorKey } from "@/components/Revision/RevisionDiff";

// Generic clone of the feature flow's Changes-tab diff chrome
// (components/Reviews/Feature/RevisionDiffUtils.tsx `DiffContent`): a
// JSON/raw format toggle + Copy-as export over the JSON diff list. The feature
// `DiffContent` is typed around FeatureRevisionInterface (required `feature`,
// `FeatureRevisionDiff[]`, feature notes + ramp/action supplemental diffs), so
// it's cloned here adapted to the generic revision `DiffItem` shape rather than
// generalized in place — the feature side stays untouched. The diff ITEMS stay
// entity-specific (each side's own diff hook); only the rendering chrome is
// shared. Reuses the feature's DiffFormatToggle / ExpandableDiff / CopyAsButton.
export function RevisionDiffContent({
  diffs,
  diffComments,
  raw,
  entityName,
  entityNoun = "revision",
  formats = ["json", "raw"],
  showCopyAs = true,
}: {
  diffs: DiffItem[];
  // Gutter comment wiring for the JSON diffs (see ExpandableDiff).
  diffComments?: DiffCommentsProps;
  // Whole before/after of the entity, powering the "Raw JSON" view + the
  // Copy-as full/LLM formats.
  raw?: { before: unknown; after: unknown; title?: string };
  // Entity display name, used in the Copy-as exports.
  entityName: string;
  // Noun for the Copy-as wording ("Changes to <noun> …"); e.g. "saved group".
  entityNoun?: string;
  // Which view formats to offer (defaults to JSON + Raw, matching the feature
  // Changes tab; the Conversation tab renders the formatted summary itself).
  formats?: DiffFormat[];
  showCopyAs?: boolean;
}) {
  const [format, setFormat] = useDiffFormat();
  const allowed = formats;
  // Clamp the shared preference into this surface's formats; fall back from
  // "raw" when no whole-shape data was supplied.
  let effective: DiffFormat = allowed.includes(format)
    ? format
    : allowed.includes("json")
      ? "json"
      : allowed[0];
  if (effective === "raw" && !raw) {
    effective = allowed.includes("json") ? "json" : allowed[0];
  }

  const diffsWithChanges = diffs.filter((d) => d.a !== d.b);
  const copyDiffs = diffsWithChanges.map((d) => ({
    title: d.label,
    a: d.a,
    b: d.b,
  }));
  // FormattedChanges shape for the offscreen render that powers "Copy as →
  // Formatted changes" (matches the feature flow's exact on-screen rich text).
  const formattedItems: FormattedChangeItem[] = diffsWithChanges.map((d) => ({
    title: d.label,
    a: d.a,
    b: d.b,
    customRender: d.customRender ?? null,
  }));

  // Always-mounted, offscreen copy of the formatted render so "Copy as →
  // Formatted changes" reads its innerText regardless of the active view.
  const formattedRef = useRef<HTMLDivElement>(null);

  if (diffsWithChanges.length === 0) {
    return (
      <Box p="4">
        <Text color="text-low">No changes between these revisions.</Text>
      </Box>
    );
  }

  return (
    <Box p="4">
      {(allowed.filter((f) => f !== "raw" || !!raw).length >= 2 ||
        showCopyAs) && (
        <Flex align="center" justify="between" gap="2" wrap="wrap" mb="3">
          <DiffFormatToggle
            value={effective}
            setValue={setFormat}
            showRaw={!!raw}
            options={allowed}
          />
          {showCopyAs && (
            <Box ml="auto">
              <CopyAsButton
                entityName={entityName}
                entityNoun={entityNoun}
                diffs={copyDiffs}
                raw={raw}
                formattedRef={formattedRef}
              />
            </Box>
          )}
        </Flex>
      )}

      {/* Offscreen render used purely as the source for "Copy as → Formatted
          changes" innerText; kept mounted in every view (mirrors the feature
          DiffContent). */}
      {showCopyAs && (
        <Box
          ref={formattedRef}
          aria-hidden
          style={{
            position: "absolute",
            left: -99999,
            top: 0,
            width: 800,
            pointerEvents: "none",
          }}
        >
          <FormattedChanges diffs={formattedItems} />
        </Box>
      )}

      {effective === "raw" && raw ? (
        <ExpandableDiff
          title={raw.title ?? `${capitalizeFirstLetter(entityNoun)} revision`}
          a={stringifyForRawDiff(raw.before)}
          b={stringifyForRawDiff(raw.after)}
          defaultOpen={true}
          styles={COMPACT_DIFF_STYLES}
          anchorKey="raw"
          comments={diffComments}
        />
      ) : (
        <Flex direction="column">
          {diffsWithChanges.map((d, i) => (
            <ExpandableDiff
              key={i}
              title={d.label}
              a={d.a}
              b={d.b}
              defaultOpen={true}
              styles={COMPACT_DIFF_STYLES}
              anchorKey={
                diffComments ? diffSectionAnchorKey(d.label) : undefined
              }
              comments={diffComments}
            />
          ))}
        </Flex>
      )}
    </Box>
  );
}
