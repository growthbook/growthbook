import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import React, { useMemo, useState, type ReactElement } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { isActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";
import { getPrerequisites } from "@/services/features";
import track, { entityTrackingHash } from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import { LockedRowMenu } from "@/components/Features/ScheduleLock";
import ValueDisplay from "@/components/Features/ValueDisplay";
import InvalidPrereqConditionBadge from "@/components/Features/InvalidPrereqConditionBadge";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import Text from "@/ui/Text";
import {
  revealedByQuickEdit,
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { featureStatusColors } from "./FeaturesOverview";
import StateIcon from "./StateIcon";
import { useFeaturePageRedesign } from "./FeaturePageRedesign";

interface Props {
  i: number;
  prerequisite: FeaturePrerequisite;
  feature: FeatureInterface;
  prereqDefaultValue?: string;
  environments: Environment[];
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  setPrerequisiteModal: (prerequisite: { i: number }) => void;
  revisionList: MinimalFeatureRevisionInterface[];
  gatedEnvSet: Set<string> | "all" | "none";
  isLocked?: boolean;
  // Shows the menu disabled rather than hiding it.
  lockedBySchedule?: boolean;
  labelWidth?: number;
  colWidth?: number;
}

export default function PrerequisiteStatusRow({
  i,
  prerequisite,
  feature,
  prereqDefaultValue,
  environments,
  mutate,
  setVersion,
  setPrerequisiteModal,
  revisionList,
  gatedEnvSet,
  isLocked = false,
  lockedBySchedule = false,
  labelWidth = 200,
  colWidth = 120,
}: Props) {
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canEditFeatureDrafts(feature);
  const redesign = useFeaturePageRedesign();
  const [open, setOpen] = useState(false);
  // Pinned when the modal opens: `feature` is reactive, so reading the list at
  // submit time would compare the current list against itself while `i` still
  // points at the row the user saw.
  const [deleteBaseline, setDeleteBaseline] = useState<
    FeaturePrerequisite[] | null
  >(null);

  const envs = environments.map((e) => e.id);

  // Fetch prerequisite states from backend with JIT feature loading
  // Note: We don't check !!parentFeature because the backend will JIT load cross-project prerequisites
  const { states: prereqStates, loading: prereqStatesLoading } =
    usePrerequisiteStates({
      featureId: prerequisite.id,
      environments: envs,
      enabled: !!prerequisite.id,
    });

  const defaultValues: Record<string, string> | undefined =
    prereqDefaultValue !== undefined
      ? Object.fromEntries(envs.map((env) => [env, prereqDefaultValue]))
      : undefined;

  const deleteModal = deleteBaseline ? (
    <DeletePrerequisiteModal
      i={i}
      feature={feature}
      baseline={deleteBaseline}
      revisionList={revisionList}
      gatedEnvSet={gatedEnvSet}
      mutate={mutate}
      setVersion={setVersion}
      close={() => setDeleteBaseline(null)}
    />
  ) : null;

  const menu = !canEdit ? null : lockedBySchedule ? (
    <LockedRowMenu style={{ margin: 0 }} />
  ) : isLocked ? null : (
    <DropdownMenu
      trigger={
        <MoreMenuTrigger
          label="Prerequisite actions"
          style={{ marginRight: 0 }}
        />
      }
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            setPrerequisiteModal({ i });
            setOpen(false);
          }}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          color="red"
          onClick={() => {
            setOpen(false);
            setDeleteBaseline(getPrerequisites(feature));
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenu>
  );

  return (
    <>
      {deleteModal}
      <Flex
        align="center"
        className={redesign ? revealsQuickEdit : undefined}
        style={{ borderTop: "1px solid var(--gray-4)" }}
      >
        {/* Indented under the "Prerequisites" label above the rows. */}
        <Box
          style={{ width: labelWidth, flexShrink: 0, minWidth: 0 }}
          py="2"
          pl={redesign ? "3" : undefined}
        >
          <Flex align="center" gap="1">
            <a
              href={`/features/${prerequisite.id}`}
              target="_blank"
              rel="noreferrer"
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {prerequisite.id}
            </a>
            <InvalidPrereqConditionBadge
              condition={prerequisite.condition}
              iconOnly
            />
            {/* Shows when the row is pointed at. */}
            <Flex
              className={redesign ? revealedByQuickEdit : undefined}
              flexShrink="0"
            >
              {menu}
            </Flex>
          </Flex>
        </Box>
        {envs.length > 0 && (
          <PrerequisiteStatesCols
            prereqStates={prereqStates ?? undefined}
            defaultValues={defaultValues}
            envs={envs}
            loading={prereqStatesLoading}
            colWidth={colWidth}
          />
        )}
      </Flex>
    </>
  );
}

// Removes a top-level prerequisite, into a draft the user picks.
export function DeletePrerequisiteModal({
  i,
  feature,
  baseline,
  revisionList,
  gatedEnvSet,
  mutate,
  setVersion,
  close,
}: {
  i: number;
  feature: FeatureInterface;
  // The list as it was when the user chose to remove `i`.
  baseline: FeaturePrerequisite[];
  revisionList: MinimalFeatureRevisionInterface[];
  gatedEnvSet: Set<string> | "all" | "none";
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const latestActiveDraft = useMemo(
    () =>
      revisionList
        .filter((r) => isActiveDraftStatus(r.status))
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [revisionList],
  );
  const [mode, setMode] = useState<DraftMode>(
    latestActiveDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    latestActiveDraft?.version ?? null,
  );

  return (
    <Modal
      trackingEventModalType="delete-prerequisite"
      header="Delete Prerequisite"
      size="lg"
      open={true}
      close={close}
      cta="Delete"
      submit={async () => {
        close();
        track("Delete Prerequisite", {
          entity_id_hash: entityTrackingHash(feature.id),
          prerequisiteIndex: i,
        });
        const draftBody =
          mode === "existing"
            ? { targetDraftVersion: selectedDraft }
            : { forceNewDraft: true };
        const res = await apiCall<{ draftVersion: number }>(
          `/feature/${feature.id}/prerequisite`,
          {
            method: "DELETE",
            // Index-addressed, so the list it was read from has to match.
            body: JSON.stringify({ i, baseline, ...draftBody }),
          },
        );
        await mutate();
        const resolvedVersion =
          res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion !== null) setVersion(resolvedVersion);
      }}
    >
      <Box style={{ minHeight: 300 }}>
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={false}
          gatedEnvSet={gatedEnvSet}
        />
        <p>Are you sure you want to delete this prerequisite?</p>
      </Box>
    </Modal>
  );
}

export function PrerequisiteStatesCols({
  prereqStates,
  defaultValues, // "true" | "false" defaultValues will override the UI for the "live" state
  envs,
  isSummaryRow = false,
  loading = false,
  tooltipBodyWrapper,
  colWidth = 120,
  compact = false,
  usePortal = false,
}: {
  prereqStates?: Record<string, PrerequisiteStateResult>;
  defaultValues?: Record<string, string>;
  envs: string[];
  isSummaryRow?: boolean;
  loading?: boolean;
  /** When set (e.g. from Features overview), appended after each tooltip body. */
  tooltipBodyWrapper?: (body: ReactElement) => ReactElement;
  colWidth?: number;
  compact?: boolean;
  /** Renders tooltips at the document root, for columns inside a scroll area. */
  usePortal?: boolean;
}) {
  const iconSize = compact ? 14 : 20;
  const featureLabel = isSummaryRow
    ? "The current feature"
    : "This prerequisite";

  const wrapTooltipBody = tooltipBodyWrapper ?? ((body: ReactElement) => body);

  return (
    <>
      {envs.map((env) => {
        const content = (
          <>
            {loading && (
              <Tooltip
                usePortal={usePortal}
                flipTheme={false}
                body={
                  <Text size="sm" color="text-high">
                    Loading prerequisite state...
                  </Text>
                }
              >
                <LoadingSpinner />
              </Tooltip>
            )}
            {!loading &&
              prereqStates?.[env]?.state === "deterministic" &&
              prereqStates?.[env]?.value !== null && (
                <Tooltip
                  usePortal={usePortal}
                  popperClassName="text-left"
                  flipTheme={false}
                  body={wrapTooltipBody(
                    <Text as="div" size="sm" color="text-high">
                      {defaultValues?.[env] === undefined && (
                        <>
                          {featureLabel} is{" "}
                          <strong style={{ color: featureStatusColors.on }}>
                            live
                          </strong>{" "}
                          in this environment.
                        </>
                      )}
                      {defaultValues?.[env] === "true" && (
                        <>
                          {featureLabel} is{" "}
                          <strong style={{ color: featureStatusColors.on }}>
                            live
                          </strong>{" "}
                          and currently serving{" "}
                          <span
                            style={{
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-1)",
                              backgroundColor: "var(--gray-a3)",
                            }}
                          >
                            <ValueDisplay value={"true"} type="boolean" />
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                      {defaultValues?.[env] === "false" && (
                        <>
                          {featureLabel} is currently serving{" "}
                          <span
                            style={{
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-1)",
                              backgroundColor: "var(--gray-a3)",
                            }}
                          >
                            <ValueDisplay value={"false"} type="boolean" />
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                    </Text>,
                  )}
                >
                  <StateIcon
                    state={defaultValues?.[env] === "false" ? "off" : "on"}
                    size={iconSize}
                  />
                </Tooltip>
              )}
            {!loading &&
              prereqStates?.[env]?.state === "deterministic" &&
              prereqStates?.[env]?.value === null && (
                <Tooltip
                  usePortal={usePortal}
                  popperClassName="text-left"
                  flipTheme={false}
                  body={wrapTooltipBody(
                    <Text as="div" size="sm" color="text-high">
                      {featureLabel} is{" "}
                      <strong style={{ color: featureStatusColors.off }}>
                        not live
                      </strong>{" "}
                      in this environment.
                      {isSummaryRow && (
                        <>
                          {" "}
                          It will evaluate to <code>null</code>.
                        </>
                      )}
                    </Text>,
                  )}
                >
                  <StateIcon state="off" size={iconSize} />
                </Tooltip>
              )}
            {!loading && prereqStates?.[env]?.state === "conditional" && (
              <Tooltip
                usePortal={usePortal}
                popperClassName="text-left"
                flipTheme={false}
                body={wrapTooltipBody(
                  isSummaryRow ? (
                    <Text as="div" size="sm" color="text-high">
                      {featureLabel} is in a{" "}
                      <strong style={{ color: featureStatusColors.warning }}>
                        Schrödinger state
                      </strong>{" "}
                      in this environment. We can&apos;t know whether it is live
                      or not until its prerequisites are evaluated at runtime in
                      the SDK. It may evaluate to <code>null</code> at runtime.
                    </Text>
                  ) : (
                    <Text as="div" size="sm" color="text-high">
                      {featureLabel} is in a{" "}
                      <strong style={{ color: featureStatusColors.warning }}>
                        Schrödinger state
                      </strong>{" "}
                      in this environment. We can&apos;t know its value until it
                      is evaluated at runtime in the SDK.
                    </Text>
                  ),
                )}
              >
                <StateIcon state="varies" size={iconSize} />
              </Tooltip>
            )}
            {!loading && prereqStates?.[env]?.state === "cyclic" && (
              <Tooltip
                usePortal={usePortal}
                popperClassName="text-left"
                flipTheme={false}
                body={wrapTooltipBody(
                  <Text as="div" size="sm" color="text-high">
                    Circular dependency detected. Please fix.
                  </Text>,
                )}
              >
                <StateIcon state="cycle" size={iconSize} />
              </Tooltip>
            )}
            {/* No state data is available */}
            {!loading && !prereqStates?.[env] && (
              <Tooltip
                usePortal={usePortal}
                popperClassName="text-left"
                flipTheme={false}
                body={wrapTooltipBody(
                  <Text as="div" size="sm" color="text-high">
                    Unable to determine prerequisite state.
                  </Text>,
                )}
              >
                <StateIcon state="unknown" size={iconSize} />
              </Tooltip>
            )}
          </>
        );

        return (
          <Box key={env} style={{ width: colWidth, flexShrink: 0 }}>
            <Flex justify="center" align="center" py={compact ? "0" : "2"}>
              {content}
            </Flex>
          </Box>
        );
      })}
    </>
  );
}
