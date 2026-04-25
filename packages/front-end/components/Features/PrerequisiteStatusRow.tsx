import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import { FaExclamationCircle, FaQuestion } from "react-icons/fa";
import { Environment } from "shared/types/organization";
import React, { useMemo, useState, type ReactElement } from "react";
import {
  FaCircleCheck,
  FaCircleQuestion,
  FaCircleXmark,
  FaRegCircleCheck,
  FaRegCircleQuestion,
  FaRegCircleXmark,
} from "react-icons/fa6";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import ValueDisplay from "@/components/Features/ValueDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import Text from "@/ui/Text";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { featureStatusColors } from "./FeaturesOverview";

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
  labelWidth = 200,
  colWidth = 120,
}: Props) {
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canViewFeatureModal(feature.project);
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const latestActiveDraft = useMemo(
    () =>
      revisionList
        .filter((r) =>
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [revisionList],
  );
  const [deleteMode, setDeleteMode] = useState<DraftMode>(
    latestActiveDraft != null ? "existing" : "new",
  );
  const [deleteSelectedDraft, setDeleteSelectedDraft] = useState<number | null>(
    latestActiveDraft?.version ?? null,
  );

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

  const deleteModal = showDeleteModal && (
    <Modal
      trackingEventModalType="delete-prerequisite"
      header="Delete Prerequisite"
      size="lg"
      open={true}
      close={() => setShowDeleteModal(false)}
      cta="Delete"
      submit={async () => {
        setShowDeleteModal(false);
        track("Delete Prerequisite", { prerequisiteIndex: i });
        const draftBody =
          deleteMode === "existing"
            ? { targetDraftVersion: deleteSelectedDraft }
            : { forceNewDraft: true };
        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/prerequisite`,
          {
            method: "DELETE",
            body: JSON.stringify({ i, ...draftBody }),
          },
        );
        await mutate();
        const resolvedVersion =
          res?.version ??
          (deleteMode === "existing" ? deleteSelectedDraft : null);
        if (resolvedVersion != null) setVersion(resolvedVersion);
      }}
    >
      <Box style={{ minHeight: 300 }}>
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={deleteMode}
          setMode={setDeleteMode}
          selectedDraft={deleteSelectedDraft}
          setSelectedDraft={setDeleteSelectedDraft}
          canAutoPublish={false}
          gatedEnvSet={gatedEnvSet}
        />
        <p>Are you sure you want to delete this prerequisite?</p>
      </Box>
    </Modal>
  );

  const menu = canEdit && !isLocked && (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          style={{ marginRight: 0 }}
        >
          <BsThreeDotsVertical size={18} />
        </IconButton>
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
            setShowDeleteModal(true);
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
      <Flex align="center" style={{ borderTop: "1px solid var(--gray-4)" }}>
        <Box style={{ width: labelWidth, flexShrink: 0, minWidth: 0 }} py="2">
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
            <Box style={{ flexShrink: 0 }}>{menu}</Box>
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

export function PrerequisiteStatesCols({
  prereqStates,
  defaultValues, // "true" | "false" defaultValues will override the UI for the "live" state
  envs,
  isSummaryRow = false,
  loading = false,
  tooltipBodyWrapper,
  colWidth = 120,
}: {
  prereqStates?: Record<string, PrerequisiteStateResult>;
  defaultValues?: Record<string, string>;
  envs: string[];
  isSummaryRow?: boolean;
  loading?: boolean;
  /** When set (e.g. from Features overview), appended after each tooltip body. */
  tooltipBodyWrapper?: (body: ReactElement) => ReactElement;
  colWidth?: number;
}) {
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
                flipTheme={false}
                body={
                  <Text size="small" color="text-high">
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
                  popperClassName="text-left"
                  flipTheme={false}
                  body={wrapTooltipBody(
                    <Text as="div" size="small" color="text-high">
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
                  {defaultValues?.[env] === "false" ? (
                    isSummaryRow ? (
                      <FaCircleXmark
                        size={20}
                        style={{ color: featureStatusColors.offMuted }}
                      />
                    ) : (
                      <FaRegCircleXmark
                        size={20}
                        style={{ color: featureStatusColors.offMuted }}
                      />
                    )
                  ) : isSummaryRow ? (
                    <FaCircleCheck
                      size={20}
                      style={{ color: featureStatusColors.on }}
                    />
                  ) : (
                    <FaRegCircleCheck
                      size={20}
                      style={{ color: featureStatusColors.on }}
                    />
                  )}
                </Tooltip>
              )}
            {!loading &&
              prereqStates?.[env]?.state === "deterministic" &&
              prereqStates?.[env]?.value === null && (
                <Tooltip
                  popperClassName="text-left"
                  flipTheme={false}
                  body={wrapTooltipBody(
                    <Text as="div" size="small" color="text-high">
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
                  {isSummaryRow ? (
                    <FaCircleXmark
                      size={20}
                      style={{ color: featureStatusColors.offMuted }}
                    />
                  ) : (
                    <FaRegCircleXmark
                      size={20}
                      style={{ color: featureStatusColors.offMuted }}
                    />
                  )}
                </Tooltip>
              )}
            {!loading && prereqStates?.[env]?.state === "conditional" && (
              <Tooltip
                popperClassName="text-left"
                flipTheme={false}
                body={wrapTooltipBody(
                  isSummaryRow ? (
                    <Text as="div" size="small" color="text-high">
                      {featureLabel} is in a{" "}
                      <strong style={{ color: featureStatusColors.warning }}>
                        Schrödinger state
                      </strong>{" "}
                      in this environment. We can&apos;t know whether it is live
                      or not until its prerequisites are evaluated at runtime in
                      the SDK. It may evaluate to <code>null</code> at runtime.
                    </Text>
                  ) : (
                    <Text as="div" size="small" color="text-high">
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
                {isSummaryRow ? (
                  <FaCircleQuestion
                    size={20}
                    style={{ color: featureStatusColors.warning }}
                  />
                ) : (
                  <FaRegCircleQuestion
                    size={20}
                    style={{ color: featureStatusColors.warning }}
                  />
                )}
              </Tooltip>
            )}
            {!loading && prereqStates?.[env]?.state === "cyclic" && (
              <Tooltip
                popperClassName="text-left"
                flipTheme={false}
                body={wrapTooltipBody(
                  <Text as="div" size="small" color="text-high">
                    Circular dependency detected. Please fix.
                  </Text>,
                )}
              >
                <FaExclamationCircle
                  size={20}
                  style={{ color: featureStatusColors.danger }}
                />
              </Tooltip>
            )}
            {/* No state data is available */}
            {!loading && !prereqStates?.[env] && (
              <Tooltip
                popperClassName="text-left"
                flipTheme={false}
                body={wrapTooltipBody(
                  <Text as="div" size="small" color="text-high">
                    Unable to determine prerequisite state.
                  </Text>,
                )}
              >
                <FaQuestion
                  size={20}
                  style={{ color: featureStatusColors.offMuted }}
                />
              </Tooltip>
            )}
          </>
        );

        return (
          <Box key={env} style={{ width: colWidth, flexShrink: 0 }}>
            <Flex justify="center" align="center" py="2">
              {content}
            </Flex>
          </Box>
        );
      })}
    </>
  );
}
