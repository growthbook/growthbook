import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
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
import {
  COMPACT_DIFF_STYLES,
  diffLabelText,
} from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
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
  // Copy-as full/LLM formats. `title` is the translated heading of that view.
  raw?: { before: unknown; after: unknown; title: string };
  // Entity display name, used in the Copy-as exports.
  entityName: string;
  // English noun for the Copy-as exports ("Changes to <noun> …" and the
  // entity type); e.g. "saved group". Exports aren't translated.
  entityNoun?: string;
  // Which view formats to offer (defaults to JSON + Raw, matching the feature
  // Changes tab; the Conversation tab renders the formatted summary itself).
  formats?: DiffFormat[];
  showCopyAs?: boolean;
}) {
  const { i18n } = useLingui();
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
    title: diffLabelText(d, i18n),
    a: d.a,
    b: d.b,
    customRender: d.customRender ?? null,
  }));

  if (diffsWithChanges.length === 0) {
    return (
      <Box p="4">
        <Text color="text-low">
          <Trans>No changes between these revisions.</Trans>
        </Text>
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
                formattedChanges={<FormattedChanges diffs={formattedItems} />}
              />
            </Box>
          )}
        </Flex>
      )}

      {effective === "raw" && raw ? (
        <ExpandableDiff
          title={raw.title}
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
              title={diffLabelText(d, i18n)}
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
