import { CSSProperties, ReactNode, useMemo, useState } from "react";
import {
  filterEnvironmentsByFeature,
  parsePlainJSONObject,
  resolveSparseJSONValue,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { BsThreeDotsVertical } from "react-icons/bs";
import { EnvEnabledIndicator } from "@/components/Features/FeatureDiffRenders";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import ReviewCommentCard from "@/components/Reviews/ReviewCommentCard";
import ForceSummary from "@/components/Features/ForceSummary";
import { useManagedFlagRename } from "@/components/Experiment/ManagedFlagRename";
import { LABEL_WIDTH } from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { variationLabel } from "@/components/Experiment/TabbedPage/variationValues";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";
import VariationLabel from "@/ui/VariationLabel";
import Field from "@/components/Forms/Field";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";
import { ManagedFlagReview } from "./useManagedFlagReview";

/** Each environment the flag can run in, live and as the draft leaves it. */
function useManagedEnvironments(info: LinkedFeatureInfo) {
  const allEnvironments = useEnvironments();
  const liveEnvStates = info.liveEnvironmentStates ?? {};
  const draftEnvStates = info.pendingDraft?.environmentStates ?? liveEnvStates;
  const envIds = filterEnvironmentsByFeature(allEnvironments, info.feature).map(
    (env) => env.id,
  );
  const draftStateOf = (envId: string) =>
    draftEnvStates[envId] ?? liveEnvStates[envId];
  const envToggles = envIds.map((envId) => ({
    envId,
    from: liveEnvStates[envId] === "active",
    to: draftStateOf(envId) === "active",
  }));
  return { envIds, draftStateOf, envToggles };
}

type ReviewVariation = { id: string; name: string; index: number };

// A diff's before and after halves, as the feature diff colours them.
const DIFF_TINT = {
  before: { background: "var(--red-a2)", borderColor: "var(--red-a5)" },
  after: { background: "var(--green-a2)", borderColor: "var(--green-a5)" },
} as const;
type DiffTint = (typeof DIFF_TINT)[keyof typeof DIFF_TINT];

/**
 * The room a tinted side takes. Labels and headers take it too (`flush` drops
 * the sides, for the label column) so every cell's text starts level.
 */
function DiffInset({
  tint,
  flush = false,
  children,
}: {
  tint?: DiffTint;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      px={flush ? "0" : "2"}
      py="1"
      minWidth="0"
      style={{
        borderRadius: "var(--radius-3)",
        border: "1px solid transparent",
        ...tint,
      }}
    >
      {children}
    </Box>
  );
}

function ColumnLabel({ children }: { children: string }) {
  return (
    <Text size="md" weight="semibold" color="text-low">
      {children}
    </Text>
  );
}

// The rule between the live and published columns.
const AFTER_COLUMN = { borderLeft: "1px solid var(--gray-a5)" };

/**
 * The Values flag as its draft leaves it, a row per environment and variation.
 * Once it's live (`showChanges`), a side-by-side diff: live on the left, as
 * published on the right.
 */
export function ManagedValues({
  info,
  variations,
  showChanges,
  heading,
}: {
  info: LinkedFeatureInfo;
  variations: ReviewVariation[];
  showChanges: boolean;
  // The section's heading, which the diff's header row carries.
  heading?: ReactNode;
}) {
  const [showEnvDetails, setShowEnvDetails] = useState(false);
  const { featureId: shownFlagId } = useManagedFlagRename(info.feature.id);
  const { envIds, draftStateOf, envToggles } = useManagedEnvironments(info);
  const draft = info.pendingDraft;
  const values = draft?.values ?? info.values;
  const liveValueType = info.feature.valueType;
  const valueType = draft?.valueType ?? liveValueType;
  const sparse = draft?.sparse ?? info.sparse ?? false;
  const valueFor = (variationId: string) =>
    values.find((v) => v.variationId === variationId)?.value;
  // `values` are the draft's when live has no matching rule.
  const liveValueFor = (variationId: string) =>
    info.liveValues?.find((v) => v.variationId === variationId)?.value;
  const liveSparse = info.liveSparse ?? false;
  // A managed flag's default is its control value, which the others patch.
  const controlId = variations[0]?.id;
  const sparseBase =
    (controlId ? valueFor(controlId) : undefined) ??
    draft?.defaultValue ??
    info.feature.defaultValue;
  const displayFeature = useMemo(
    () => ({ ...info.feature, valueType, defaultValue: sparseBase }),
    [info.feature, valueType, sparseBase],
  );
  const liveSparseBase =
    (controlId ? liveValueFor(controlId) : undefined) ??
    info.feature.defaultValue;
  const liveDisplayFeature = useMemo(
    () => ({ ...info.feature, defaultValue: liveSparseBase }),
    [info.feature, liveSparseBase],
  );
  // What a card shows, so a tint means the served value moved: a sparse patch
  // reads merged onto the control value.
  const servedValue = (
    raw: string | undefined,
    isSparse: boolean,
    base: string | undefined,
    type: string,
  ) =>
    raw === undefined
      ? null
      : JSON.stringify(
          isSparse && type === "json"
            ? resolveSparseJSONValue(raw, parsePlainJSONObject(base ?? ""))
            : raw,
        );
  // Unpacked only when the rule and the switch disagree.
  const envConflict =
    showChanges &&
    envIds.some((envId) => draftStateOf(envId) === "disabled-env");

  const valueCard = (
    v: ReviewVariation,
    value: string | undefined,
    feature: typeof displayFeature,
    isSparse: boolean,
    tint?: DiffTint,
  ) => (
    <Frame px="3" py="3" mb="0" minWidth="0" style={tint}>
      <Box mb="2">
        <VariationLabel number={v.index} name={variationLabel(v)} />
      </Box>
      {value === undefined ? (
        <HelperText status="warning">No value set</HelperText>
      ) : (
        <ForceSummary
          label={null}
          value={value}
          feature={feature}
          sparse={isSparse && v.id !== controlId}
          showCopyButton={false}
        />
      )}
    </Frame>
  );
  const envLabel = envToggles.length === 1 ? "Environment" : "Environments";
  const envDetails = envConflict ? (
    <Box mt="2">
      <Link
        onClick={() => setShowEnvDetails((v) => !v)}
        weight="medium"
        aria-expanded={showEnvDetails}
      >
        {showEnvDetails ? "Hide details" : "Show details"}
      </Link>
      {showEnvDetails && (
        <Flex direction="column" gap="1" mt="2">
          {envIds.map((envId) => {
            const state = draftStateOf(envId);
            const ruleCovers = state === "active" || state === "disabled-env";
            const switchOn = state === "active" || state === "disabled-rule";
            return (
              <Text key={envId} size="sm" color="text-mid">
                <Text weight="medium">{envId}</Text>: experiment{" "}
                {ruleCovers ? "covers" : "does not cover"} it; the Feature
                Flag&apos;s environment switch is {switchOn ? "on" : "off"}
                {state === "disabled-env"
                  ? " — nothing serves here until the switch is turned on."
                  : "."}
              </Text>
            );
          })}
        </Flex>
      )}
    </Box>
  ) : null;

  // Not a link: the experiment edits its flag. Renamed only while a draft, so
  // it reads with any rename the page stages.
  const flagKey = <Text color="text-high">{shownFlagId}</Text>;

  const envState = (envId: string, enabled: boolean) => (
    <Flex align="center" gap="2" minWidth="0">
      <EnvEnabledIndicator enabled={enabled} />
      <Text weight="medium" color="text-high" truncate title={envId}>
        {envId}
      </Text>
    </Flex>
  );
  // Rows of one group sit close; the group keeps the table's outer spacing.
  const groupSpacing = (
    i: number,
    count: number,
    gap: string | number,
  ): CSSProperties => ({
    paddingTop: i ? gap : undefined,
    paddingBottom: i < count - 1 ? gap : undefined,
  });
  // A card carries its own tint; anything else takes the side's. A draft has
  // no live side, so it shows only what it will be.
  const row = (
    key: string,
    label: string,
    changed: boolean,
    before: ReactNode,
    after: ReactNode,
    card = false,
    spacing?: CSSProperties,
  ) => {
    const side = (content: ReactNode, which: keyof typeof DIFF_TINT) =>
      card ? (
        content
      ) : (
        <DiffInset tint={showChanges && changed ? DIFF_TINT[which] : undefined}>
          {content}
        </DiffInset>
      );
    return (
      <TableRow key={key}>
        {/* Flush, so the labels line up with the page's other rows. */}
        <TableCell style={{ width: LABEL_WIDTH, paddingLeft: 0, ...spacing }}>
          {label ? (
            <DiffInset flush>
              <Text weight="medium" color="text-high">
                {label}
              </Text>
            </DiffInset>
          ) : null}
        </TableCell>
        {showChanges ? (
          <TableCell style={spacing}>{side(before, "before")}</TableCell>
        ) : null}
        <TableCell
          style={{ ...(showChanges ? AFTER_COLUMN : null), ...spacing }}
        >
          {side(after, "after")}
        </TableCell>
      </TableRow>
    );
  };
  return (
    <>
      <Table variant="ghost">
        {showChanges ? (
          <TableHeader>
            {/* Centred, so the larger section heading sits level with them. */}
            <TableRow style={{ verticalAlign: "middle" }}>
              <TableColumnHeader style={{ width: LABEL_WIDTH, paddingLeft: 0 }}>
                {heading}
              </TableColumnHeader>
              <TableColumnHeader>
                <DiffInset>
                  <ColumnLabel>Live</ColumnLabel>
                </DiffInset>
              </TableColumnHeader>
              <TableColumnHeader style={AFTER_COLUMN}>
                <DiffInset>
                  <ColumnLabel>After publishing</ColumnLabel>
                </DiffInset>
              </TableColumnHeader>
            </TableRow>
          </TableHeader>
        ) : null}
        {/* Only the header is ruled; the tints mark the changes. Rows size
            to their content, so a group can sit close. */}
        <TableBody
          style={
            {
              "--table-row-box-shadow": "none",
              "--table-cell-min-height": "auto",
            } as CSSProperties
          }
        >
          {row("featureFlag", "Feature Flag", false, flagKey, flagKey)}
          {envToggles.map((t, i) =>
            row(
              `env-${t.envId}`,
              i ? "" : envLabel,
              t.from !== t.to,
              envState(t.envId, t.from),
              envState(t.envId, t.to),
              false,
              groupSpacing(i, envToggles.length, 0),
            ),
          )}
          {row(
            "valueType",
            "Value type",
            valueType !== liveValueType,
            <Text color="text-high">{liveValueType}</Text>,
            <Text color="text-high">{valueType}</Text>,
          )}
          {variations.map((v, i) => {
            const liveValue = liveValueFor(v.id);
            const value = valueFor(v.id);
            const isControl = v.id === controlId;
            const changed =
              showChanges &&
              servedValue(
                liveValue,
                !isControl && liveSparse,
                liveSparseBase,
                liveValueType,
              ) !==
                servedValue(value, !isControl && sparse, sparseBase, valueType);
            return row(
              `variation-${v.id}`,
              i ? "" : "Variations",
              changed,
              valueCard(
                v,
                liveValue,
                liveDisplayFeature,
                liveSparse,
                changed ? DIFF_TINT.before : undefined,
              ),
              valueCard(
                v,
                value,
                displayFeature,
                sparse,
                changed ? DIFF_TINT.after : undefined,
              ),
              true,
              groupSpacing(i, variations.length, "var(--space-1)"),
            );
          })}
        </TableBody>
      </Table>
      {envDetails}
    </>
  );
}

/** Reviewers with their verdicts, once the values are up for review. */
export function ManagedFlagReviewers({
  review,
}: {
  review: ManagedFlagReview;
}) {
  const { users } = useUser();
  const { reviews, insufficientReasons, requireReviews, status } = review;
  if (!requireReviews || (!reviews.length && status !== "pending-review")) {
    return null;
  }
  return (
    <Box>
      <Text size="md" weight="medium" color="text-high" as="div" mb="2">
        Reviewers
      </Text>
      {reviews.length === 0 && (
        <Text size="sm" color="text-mid" as="div">
          No reviews yet.
        </Text>
      )}
      <Flex direction="column" gap="2">
        {reviews.map((r) => {
          const user = users.get(r.userId);
          const name = user?.name ?? "";
          const email = user?.email ?? "";
          // Stale verdicts still count; the icon mutes.
          const stale = r.status.endsWith("-stale");
          const verdict = r.status.startsWith("approved")
            ? "approved"
            : "changes-requested";
          return (
            <PersonRow
              key={r.userId}
              id={r.userId}
              name={name}
              email={email}
              trailing={
                <ReviewerVerdictIcon
                  status={verdict}
                  name={name || email}
                  timestamp={String(r.timestamp)}
                  stale={stale}
                  uncoveredReason={insufficientReasons.get(r.userId)}
                />
              }
            />
          );
        })}
      </Flex>
    </Box>
  );
}

/** The review thread, with edit and retract on the viewer's own entries. */
export function ManagedFlagReviewComments({
  review,
}: {
  review: ManagedFlagReview;
}) {
  const { userId } = useUser();
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const { reviewComments, insufficientReasons, state, post, submitting } =
    review;
  if (!reviewComments.length) return null;

  return (
    <Flex direction="column" gap="3">
      {reviewComments.map((l, i) => {
        const authorId = l.user?.id ?? null;
        const isOwn = !!authorId && authorId === userId;
        // A row with neither action would open an empty menu.
        const canEditRow = isOwn && !!l.id && !!l.comment;
        const canRetractRow =
          isOwn && !!l.isActiveVerdict && state.canUndoReview;
        const uncoveredReason =
          l.action === "Approved" && authorId
            ? insufficientReasons.get(authorId)
            : undefined;
        return (
          <ReviewCommentCard
            size="md"
            key={l.id ?? i}
            log={l}
            uncoveredReason={uncoveredReason}
            actions={
              canEditRow || canRetractRow ? (
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="1"
                      highContrast
                      aria-label="Comment actions"
                    >
                      <BsThreeDotsVertical size={14} />
                    </IconButton>
                  }
                  menuPlacement="end"
                >
                  {canEditRow && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingLogId(l.id ?? null);
                        setEditText(l.comment ?? "");
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canRetractRow && (
                    <DropdownMenuItem
                      color="red"
                      onClick={() => post("undo-review")}
                    >
                      Retract review
                    </DropdownMenuItem>
                  )}
                </DropdownMenu>
              ) : undefined
            }
            body={
              editingLogId && editingLogId === l.id ? (
                <Flex direction="column" gap="2">
                  <Field
                    textarea
                    minRows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <Flex gap="2">
                    <Button
                      disabled={submitting || !editText.trim()}
                      onClick={async () => {
                        await post(
                          `log/${l.id}`,
                          { comment: editText, version: review.version },
                          "PUT",
                        );
                        setEditingLogId(null);
                      }}
                    >
                      Save
                    </Button>
                    <Link onClick={() => setEditingLogId(null)}>Cancel</Link>
                  </Flex>
                </Flex>
              ) : undefined
            }
          />
        );
      })}
    </Flex>
  );
}
