import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import {
  MAX_SAVED_GROUP_DESCRIPTION_LENGTH,
  isInternalAttributeName,
} from "shared/constants";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
  SavedGroupInterface,
  SavedGroupType,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import {
  Revision,
  applyTopLevelPatchOps,
  JsonPatchOperation,
  getApprovalFlowSettings,
} from "shared/enterprise";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import {
  draftValuesEqual,
  isIdListSupportedAttribute,
  isRemoteGroupSupportedAttribute,
  validateAndFixCondition,
} from "shared/util";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import { PiPlus } from "react-icons/pi";
import clsx from "clsx";
import { Flex, Text } from "@radix-ui/themes";
import { useIncrementer } from "@/hooks/useIncrementer";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import ConditionInput from "@/components/Features/ConditionInput";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/ui/MultiSelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import Link from "@/ui/Link";
import SelectOwner from "@/components/Owner/SelectOwner";
import Callout from "@/ui/Callout";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import ConflictCallout, {
  ConflictProvider,
} from "@/components/DraftConflicts/ConflictContext";
import { useDraftConflict } from "@/components/DraftConflicts/useDraftConflict";
import { namedProjectsFormatter } from "@/components/DraftConflicts/conflictValues";
import SavedGroupDraftSelectorForChanges, {
  DraftMode,
} from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";

import useProjectOptions from "@/hooks/useProjectOptions";

// The upload version is a form value so resolving a conflict can change it.
type SavedGroupFormValues = CreateSavedGroupProps &
  Pick<UpdateSavedGroupProps, "currentUploadVersion">;

const TYPE_LABELS: Record<SavedGroupType, string> = {
  condition: "Condition Group",
  list: "ID List",
  remote: "Remote Group",
};

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  type: SavedGroupType;
  approvalFlowRequired?: boolean;
  metadataReviewRequired?: boolean;
  onRevisionCreated?: (revision: Revision) => void;
  openRevisions?: Revision[];
  allRevisions?: Revision[];
  selectedRevision?: Revision | null;
  onSelectRevision?: (revision: Revision | null) => void;
  liveVersion?: SavedGroupInterface;
  editInfoOnly?: boolean;
  editConditionOnly?: boolean;
  /** Remote groups: switch to this upload version, and nothing else. */
  useUploadVersion?: number;
  autoBypassApproval?: boolean;
  mutate?: () => void | Promise<void>;
}> = ({
  close,
  current,
  type,
  approvalFlowRequired,
  metadataReviewRequired,
  onRevisionCreated,
  openRevisions = [],
  allRevisions,
  selectedRevision,
  onSelectRevision,
  liveVersion,
  editInfoOnly = false,
  editConditionOnly = false,
  useUploadVersion,
  autoBypassApproval = false,
  mutate,
}) => {
  const { apiCall, orgId } = useAuth();
  const router = useRouter();
  const settings = useOrgSettings();
  const { savedGroupSizeLimit } = settings;
  const { user } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // Resolved against the group's own projects, so a project override applies.
  const approvalFlow = getApprovalFlowSettings(
    settings.approvalFlows,
    "saved-group",
    current.projects ?? [],
  );
  const isApprovalFlowRequired =
    approvalFlowRequired ?? !!approvalFlow?.required;
  const isMetadataReviewRequired =
    metadataReviewRequired ??
    (isApprovalFlowRequired && (approvalFlow?.requireMetadataReview ?? true));

  const canAdminPublish =
    !!isApprovalFlowRequired &&
    !!current.id &&
    (user?.role === "admin" ||
      (current.projects?.length
        ? current.projects.every((project) =>
            permissionsUtil.canBypassSavedGroupApprovalChecks({
              project: project || "",
            }),
          )
        : permissionsUtil.canBypassSavedGroupApprovalChecks({ project: "" })));

  // Metadata-only edit when the org's saved-group approval flow is on but
  // metadata review is off: skip the publish-now affordance in this form
  // (the user can publish from the page-level "Review & Publish" button)
  // and use revision terminology in the radio. We don't apply this when
  // approval is off entirely — without any review gate, the form keeps its
  // existing publish-now option as the convenience path.
  const isMetadataOnlyRevisionFlow =
    !!editInfoOnly && isApprovalFlowRequired && !isMetadataReviewRequired;

  const isDraftRevision = (r: Revision) =>
    ["draft", "pending-review", "changes-requested", "approved"].includes(
      r.status,
    );

  // Pick the initial draft to target: prefer the revision the caller already
  // has selected, then the current user's own open draft. Anything else falls
  // back to "Create a new draft" — we intentionally never auto-select
  // "Publish now" and we don't silently target someone else's work-in-progress.
  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(() => {
    if (selectedRevision && isDraftRevision(selectedRevision))
      return selectedRevision.id;
    const myDraft = openRevisions.find(
      (r) => isDraftRevision(r) && r.authorId === user?.id,
    );
    return myDraft?.id ?? null;
  });

  // Default mode: in the metadata-only revision flow we always start on
  // "Add to a new revision" so users get a fresh revision per metadata edit
  // (instead of silently appending onto whatever happens to be open). Other
  // modes default to the existing-draft picker when the user already has an
  // open draft to target.
  const [draftMode, setDraftMode] = useState<DraftMode>(() => {
    if (isMetadataOnlyRevisionFlow) return "new";
    return draftSelectedId ? "existing" : "new";
  });

  const allRevisionsForLabel = allRevisions ?? openRevisions;

  const [conditionKey, forceConditionRender] = useIncrementer();

  const [internalSelectedRevision] = useState<Revision | null>(
    selectedRevision ?? null,
  );

  const attributeSchema = useAttributeSchema();

  // Use controlled or internal state for selected revision
  const currentRevision =
    onSelectRevision !== undefined
      ? (selectedRevision ?? null)
      : internalSelectedRevision;

  // Editing is only blocked when viewing a discarded/merged revision in
  // read-only (and only when metadata review is enforced). The previous
  // "live has open drafts" block is no longer needed — the draft selector
  // inside this modal lets the user explicitly choose to target an existing
  // draft, create a new one, or publish, so there's nothing to protect
  // against.
  const isEditBlocked =
    isMetadataReviewRequired &&
    (currentRevision?.status === "discarded" ||
      currentRevision?.status === "merged");

  const { mutateDefinitions, project, getProjectById } = useDefinitions();
  const largeSavedGroupSupport = useLargeSavedGroupSupport(project);

  const { data: savedGroupsData } = useApi<{
    savedGroups: SavedGroupWithoutValues[];
  }>("/saved-groups");
  const savedGroups = useMemo(
    () => (savedGroupsData?.savedGroups ?? []).filter((sg) => !sg.archived),
    [savedGroupsData],
  );
  const savedGroupsLoaded = savedGroupsData !== undefined;

  const [errorMessage, setErrorMessage] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);

  useEffect(() => {
    if (current.description) {
      setShowDescription(true);
    }
  }, [current]);

  const form = useForm<SavedGroupFormValues>({
    defaultValues: {
      currentUploadVersion: useUploadVersion ?? current.currentUploadVersion,
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      condition: current.condition || "",
      type,
      values: current.values || [],
      description: current.description || "",
      projects:
        current.projects ||
        getDefaultProjectsForNewResource({
          project,
          organizationId: orgId || undefined,
        }),
    },
  });

  // Flag-only: a condition blob and an id list can't be merged granularly, so
  // the guard surfaces the change and makes the user choose rather than
  // silently overwriting it.
  const conflict = useDraftConflict<Record<string, unknown>>({
    initial: {
      groupName: current.groupName ?? "",
      owner: current.owner ?? "",
      description: current.description ?? "",
      projects: current.projects ?? [],
      ...(current.type === "condition"
        ? { condition: current.condition ?? "" }
        : current.type === "remote"
          ? { currentUploadVersion: current.currentUploadVersion ?? null }
          : { values: current.values ?? [] }),
    },
    labels: {
      groupName: "Name",
      owner: "Owner",
      description: "Description",
      projects: "Projects",
      condition: "Condition",
      values: "IDs",
      currentUploadVersion: "Upload version",
    },
    formatters: {
      projects: namedProjectsFormatter(getProjectById),
    },
    form,
    isNewDraft: draftMode === "new",
    entityNoun: "saved group",
  });

  const descriptionContested = conflict.providerProps.contested.some(
    (c) => c.key === "description",
  );

  // Live state pinned at open. Publish/new-draft submits compare against live,
  // which the hook baseline only describes when the conflict came from live.
  const [livePin] = useState<SavedGroupInterface | undefined>(
    () => liveVersion,
  );

  // Reseed only when the backing revision changes: a same-revision SWR refresh
  // must not clobber unsaved edits — the stale baseline 409s instead.
  const seedKey = currentRevision ? currentRevision.id : "__live__";
  const seededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededKeyRef.current === seedKey) return;
    seededKeyRef.current = seedKey;
    let baseData: Partial<SavedGroupInterface>;

    if (currentRevision) {
      // Apply JSON Patch ops to snapshot to derive the effective draft state
      baseData = applyTopLevelPatchOps(
        currentRevision.target.snapshot as SavedGroupInterface,
        currentRevision.target.proposedChanges as JsonPatchOperation[],
      );
    } else if (liveVersion) {
      // If "Live" is selected, use the live version
      baseData = liveVersion;
    } else {
      // Fallback to current
      baseData = current;
    }

    const currentFormValues = form.getValues();
    const newValues = {
      currentUploadVersion: useUploadVersion ?? baseData.currentUploadVersion,
      groupName: baseData.groupName || "",
      owner: baseData.owner || "",
      attributeKey: baseData.attributeKey || "",
      condition: baseData.condition || "",
      type,
      values: baseData.values || [],
      description: baseData.description || "",
      projects:
        baseData.projects ||
        getDefaultProjectsForNewResource({
          project,
          organizationId: orgId || undefined,
        }),
    };

    // Only reset if values actually changed to avoid unnecessary re-renders
    if (JSON.stringify(currentFormValues) !== JSON.stringify(newValues)) {
      form.reset(newValues);
    }

    if (baseData.description) {
      setShowDescription(true);
    }
  }, [
    seedKey,
    currentRevision,
    liveVersion,
    useUploadVersion,
    type,
    project,
    orgId,
    form,
    current,
  ]);

  const selectedProjects = form.watch("projects") || [];

  // Publishing is its own authority: an author without it edits through drafts and is
  // never offered "publish now" — the server refuses that write. Only applies to
  // edits; creating a group isn't a publish.
  //
  // BOTH sides of a move, like the endpoint's `holdsMoveDestination`: publishing a
  // group whose projects changed lands it in the destination, so authority there is
  // required too. Judging `current` alone offered publish-now for a move into a
  // project the caller cannot publish in.
  const canAutoPublish =
    (!current.id ||
      (permissionsUtil.canRevisionAction("saved-group", "publish", current) &&
        permissionsUtil.canRevisionAction("saved-group", "publish", {
          ...current,
          projects: selectedProjects,
        }))) &&
    (!isApprovalFlowRequired || canAdminPublish);
  const projectsOptions = useProjectOptions(
    (p) =>
      current.id
        ? permissionsUtil.canRevisionAction(
            "saved-group",
            "draft",
            { projects: [p] },
            NO_ENVIRONMENT_BINDING,
          )
        : permissionsUtil.canCreateSavedGroup({ projects: [p] }),
    selectedProjects,
  );
  const canCreateWithoutProject = current.id
    ? permissionsUtil.canRevisionAction(
        "saved-group",
        "draft",
        { projects: [] },
        NO_ENVIRONMENT_BINDING,
      )
    : permissionsUtil.canCreateSavedGroup({ projects: [] });
  const hasProjectPermission = current.id
    ? permissionsUtil.canRevisionAction(
        "saved-group",
        "draft",
        { projects: selectedProjects },
        NO_ENVIRONMENT_BINDING,
      )
    : permissionsUtil.canCreateSavedGroup({ projects: selectedProjects });
  const listAboveSizeLimit = savedGroupSizeLimit
    ? (form.watch("values") ?? []).length > savedGroupSizeLimit
    : false;
  const editUploadOnly = useUploadVersion !== undefined;
  // Content-only edits don't touch the fields the project check is about.
  const editContentOnly = editConditionOnly || editUploadOnly;
  const isValid = editUploadOnly
    ? true
    : editInfoOnly
      ? !!form.watch("groupName")
      : editConditionOnly
        ? !!form.watch("condition")
        : !!form.watch("groupName") &&
          (type === "condition"
            ? !!form.watch("condition")
            : !!form.watch("attributeKey") &&
              (type === "remote" ||
                !listAboveSizeLimit ||
                adminBypassSizeLimit));

  const getCtaDisabledMessage = (): string | undefined => {
    if (isEditBlocked) {
      return "This revision is discarded and cannot be edited.";
    }
    if (!hasProjectPermission && !editContentOnly) {
      if (!selectedProjects.length && projectsOptions.length > 0) {
        return "Select a project to continue.";
      }
      return `You don't have permission to ${current.id ? "update" : "create"} Saved Groups.`;
    }
    if (isValid) return undefined;
    if (editConditionOnly) {
      return form.watch("condition")
        ? undefined
        : "Add a condition to continue.";
    }
    if (!form.watch("groupName")) return "Enter a name to continue.";
    if (editInfoOnly) return undefined;
    if (type !== "condition") {
      if (!form.watch("attributeKey")) {
        return "Select an attribute key to continue.";
      }
      return listAboveSizeLimit && !adminBypassSizeLimit
        ? "List size exceeds limit. Enable bypass or reduce size."
        : undefined;
    }
    return form.watch("condition") ? undefined : "Add a condition to continue.";
  };
  const ctaDisabledMessage = getCtaDisabledMessage();

  const isSupportedAttribute =
    type === "remote"
      ? isRemoteGroupSupportedAttribute
      : isIdListSupportedAttribute;

  // Create a Map from saved groups for cycle detection
  const groupMap = useMemo(
    () => new Map(savedGroups.map((group) => [group.id, group])),
    [savedGroups],
  );

  // In a variable so the provider wrapper doesn't reindent the tree.
  const modalContent = (
    <Modal
      trackingEventModalType="saved-group-form"
      close={close}
      open={true}
      size="lg"
      header={
        editUploadOnly
          ? `Use Version ${useUploadVersion}`
          : editInfoOnly
            ? "Edit Information"
            : editConditionOnly
              ? "Edit Condition"
              : `${current.id ? "Edit" : "Add"} ${TYPE_LABELS[type]}`
      }
      cta={
        !current.id
          ? "Submit"
          : draftMode === "publish"
            ? isApprovalFlowRequired && !autoBypassApproval
              ? "Publish"
              : "Save"
            : isMetadataOnlyRevisionFlow
              ? draftMode === "existing"
                ? "Update revision"
                : "Add to a new revision"
              : "Save to draft"
      }
      submitColor={
        current.id &&
        draftMode === "publish" &&
        isApprovalFlowRequired &&
        !autoBypassApproval
          ? "danger"
          : "primary"
      }
      ctaEnabled={
        isValid &&
        (editContentOnly || hasProjectPermission) &&
        !isEditBlocked &&
        conflict.resolved
      }
      disabledMessage={ctaDisabledMessage}
      submit={form.handleSubmit(async (value) => {
        if (!editInfoOnly && type === "condition") {
          const conditionRes = validateAndFixCondition(
            value.condition,
            (c) => {
              form.setValue("condition", c);
              forceConditionRender();
            },
            true,
            groupMap,
            // Avoid false unknown-group errors while the group map is loading.
            !savedGroupsLoaded,
          );
          if (conditionRes.empty) {
            throw new Error("Condition cannot be empty");
          }
        }

        // Update existing saved group.
        //
        // Only include fields whose submitted value actually differs from
        // the baseline (`current` — the live group, or for an open draft
        // the patched snapshot the parent computes). The backend would drop
        // no-op writes anyway, but omitting them up front prevents a stale
        // form-default-vs-current mismatch (e.g. an array field whose
        // default initialised to `[]` before the sync `useEffect` ran)
        // silently turning untouched fields into real changes in the
        // produced revision.
        if (current.id) {
          const baseline = (k: keyof SavedGroupInterface) =>
            (current as Partial<SavedGroupInterface>)[k];
          const fieldChanged = (k: keyof SavedGroupFormValues) =>
            !draftValuesEqual(value[k], baseline(k));
          let payload: UpdateSavedGroupProps;
          if (editInfoOnly) {
            payload = {
              ...(fieldChanged("groupName")
                ? { groupName: value.groupName }
                : {}),
              ...(fieldChanged("owner") ? { owner: value.owner } : {}),
              ...(fieldChanged("description")
                ? { description: value.description }
                : {}),
              ...(fieldChanged("projects") ? { projects: value.projects } : {}),
            };
          } else if (editUploadOnly) {
            payload = fieldChanged("currentUploadVersion")
              ? { currentUploadVersion: value.currentUploadVersion }
              : {};
          } else if (editConditionOnly) {
            payload = fieldChanged("condition")
              ? { condition: value.condition }
              : {};
          } else {
            payload = {
              ...(fieldChanged("condition")
                ? { condition: value.condition }
                : {}),
              ...(fieldChanged("groupName")
                ? { groupName: value.groupName }
                : {}),
              ...(fieldChanged("owner") ? { owner: value.owner } : {}),
              ...(fieldChanged("values") ? { values: value.values } : {}),
              ...(fieldChanged("description")
                ? { description: value.description }
                : {}),
              ...(fieldChanged("projects") ? { projects: value.projects } : {}),
            };
          }

          // Build URL with query params based on the user's selector choice.
          // `autoBypassApproval` (the metadata-only shortcut) routes "publish"
          // through `autoPublish` rather than `bypassApproval` so non-admins
          // can still save metadata changes — matching the server-side rule
          // that honours `autoPublish` even when approval is otherwise
          // required.
          const params = new URLSearchParams();

          if (draftMode === "publish") {
            if (isApprovalFlowRequired && !autoBypassApproval) {
              params.set("bypassApproval", "1");
            } else {
              params.set("autoPublish", "1");
            }
          } else if (draftMode === "existing" && draftSelectedId) {
            params.set("revisionId", draftSelectedId);
          } else {
            params.set("forceCreateRevision", "1");
          }
          const queryString = params.toString();
          const url = `/saved-groups/${current.id}${queryString ? `?${queryString}` : ""}`;

          const guard = conflict.guard(
            payload as unknown as Record<string, unknown>,
          );
          const submitBaseline =
            livePin &&
            draftMode !== "existing" &&
            (!conflict.hasConflict || conflict.conflictFromDraft)
              ? Object.fromEntries(
                  Object.keys(payload).map((k) => [
                    k,
                    // null, not undefined: JSON drops undefined, which would
                    // skip the conflict check for a group's first upload
                    k === "currentUploadVersion"
                      ? (livePin.currentUploadVersion ?? null)
                      : (livePin as unknown as Record<string, unknown>)[k],
                  ]),
                )
              : guard.baseline;
          const res = await conflict.guarded(() =>
            apiCall<{
              status: number;
              requiresApproval?: boolean;
              revision?: Revision;
            }>(
              url,
              {
                method: "PUT",
                body: JSON.stringify({ ...payload, baseline: submitBaseline }),
              },
              guard.onError,
            ),
          );
          conflict.clear();

          // If a revision was created or updated, handle it
          if (res?.revision) {
            mutateDefinitions({});
            // Only call onRevisionCreated if the revision is still a draft
            // (when auto-published, the revision is already merged)
            if (res.revision.status !== "merged") {
              onRevisionCreated?.(res.revision);
            } else {
              // When auto-published, the merged revision is the new live
              // version. Refresh both SWR caches first so liveVersion reflects
              // the merge, then send the user to "live" (null) so the page
              // renders the live entity rather than the merged revision's
              // pre-edit snapshot.
              await mutate?.();
              onSelectRevision?.(null);
            }
            close();
            return;
          }
        }
        // Create new saved group
        let createdId: string | null = null;
        if (!current.id) {
          const payload: CreateSavedGroupProps = {
            ...value,
          };
          setErrorMessage("");
          const res = await apiCall<{ savedGroup: SavedGroupInterface }>(
            `/saved-groups`,
            {
              method: "POST",
              body: JSON.stringify(payload),
            },
            (responseData) => {
              if (responseData.status === 413) {
                setErrorMessage(
                  "Cannot import such a large CSV. Try again with a smaller payload",
                );
              }
            },
          );
          createdId = res.savedGroup.id;
        }
        mutateDefinitions({});
        await mutate?.();
        // Uploads happen on the group's page
        if (type === "remote" && createdId) {
          await router.push(`/saved-groups/${createdId}`);
        }
      })}
      error={errorMessage}
    >
      {current.id && (
        <SavedGroupDraftSelectorForChanges
          savedGroup={current as SavedGroupInterface}
          openRevisions={openRevisions}
          allRevisions={allRevisionsForLabel}
          mode={draftMode}
          setMode={setDraftMode}
          selectedDraftId={draftSelectedId}
          setSelectedDraftId={setDraftSelectedId}
          canAutoPublish={canAutoPublish}
          approvalRequired={isApprovalFlowRequired && !autoBypassApproval}
          metadataOnly={isMetadataOnlyRevisionFlow}
          alert={conflict.alert}
          alertActive={conflict.alertActive}
        />
      )}
      {conflict.callouts}
      {isEditBlocked && currentRevision && (
        <Callout status="warning" mb="4">
          <Text size="2">
            {`This revision is ${currentRevision.status} and cannot be edited. You can view it here in read-only mode.`}
          </Text>
        </Callout>
      )}
      {!editInfoOnly && !editConditionOnly && current.type === "condition" && (
        <>
          <LargeSavedGroupPerformanceWarning
            type="condition"
            {...largeSavedGroupSupport}
            openUpgradeModal={() => setUpgradeModal(true)}
          />
          <div className="form-group">
            Updating this group will automatically update any associated
            Features and Experiments.
          </div>
        </>
      )}
      {editUploadOnly && (
        <Text as="p" mb="3">
          The group will use the IDs from version {useUploadVersion}.
        </Text>
      )}
      {!editContentOnly && (
        <>
          <Field
            size="legacy"
            label={`${type === "list" ? "List" : "Group"} Name`}
            labelClassName="font-weight-bold"
            required
            {...form.register("groupName")}
            placeholder="e.g. beta-users or internal-team-members"
          />
          <ConflictCallout field="groupName" />
          {showDescription || descriptionContested ? (
            <>
              <Field
                size="legacy"
                label="Description"
                labelClassName="font-weight-bold"
                required={false}
                textarea
                maxLength={MAX_SAVED_GROUP_DESCRIPTION_LENGTH}
                value={form.watch("description")}
                onChange={(e) => {
                  form.setValue("description", e.target.value);
                }}
              />
              <ConflictCallout field="description" />
            </>
          ) : (
            <Link
              onClick={(e) => {
                e.preventDefault();
                setShowDescription(true);
              }}
              mb="5"
            >
              <Flex align="center" gap="1">
                <PiPlus />
                <Text weight="medium">Add a description</Text>
              </Flex>
            </Link>
          )}
          <MultiSelectField
            legacyHeight
            label="Projects"
            labelClassName="font-weight-bold"
            placeholder={
              canCreateWithoutProject ? "All Projects" : "Select projects..."
            }
            value={selectedProjects}
            onChange={(projects) => form.setValue("projects", projects)}
            options={projectsOptions}
            sort={false}
            closeMenuOnSelect={true}
          />
          <ConflictCallout field="projects" />
          {current.id && (
            <SelectOwner
              placeholder="Optional"
              value={form.watch("owner")}
              onChange={(v) => form.setValue("owner", v)}
            />
          )}
          <ConflictCallout field="owner" />
        </>
      )}

      {!editInfoOnly &&
        !editUploadOnly &&
        (type === "condition" ? (
          <>
            <ConditionInput
              defaultValue={form.watch("condition") || ""}
              onChange={(v) => {
                form.setValue("condition", v);
              }}
              project={selectedProjects[0] || ""}
              allowNestedSavedGroups={true}
              excludeSavedGroupId={current.id}
              // Seeds its own state from defaultValue, so a resolved conflict
              // has to remount it to show the value that was applied.
              key={`${conditionKey}-${conflict.renderKey}`}
            />
            <ConflictCallout field="condition" />
          </>
        ) : (
          <>
            <SelectField
              size="legacy"
              label="Attribute Key"
              labelClassName="font-weight-bold"
              required
              value={form.watch("attributeKey") || ""}
              disabled={!!current.attributeKey}
              onChange={(v) => form.setValue("attributeKey", v)}
              placeholder="Choose one..."
              options={attributeSchema
                .filter((a) => !isInternalAttributeName(a.property))
                .map((a) => ({
                  value: a.property,
                  label: a.property,
                }))}
              isOptionDisabled={({ label }) => {
                const attr = attributeSchema.find(
                  (attr) => attr.property === label,
                );
                if (!attr) return false;
                return !isSupportedAttribute(attr);
              }}
              sort={false}
              formatOptionLabel={({ label }) => {
                const attr = attributeSchema.find(
                  (attr) => attr.property === label,
                );
                if (!attr) return label;
                const unsupported = !isSupportedAttribute(attr);
                return (
                  <div className={clsx(unsupported ? "disabled" : "")}>
                    {label}
                    {unsupported && (
                      <span className="float-right">
                        <Tooltip
                          body={
                            type === "remote"
                              ? "Remote Groups need a string or number attribute."
                              : "The datatype for this attribute key isn't valid for ID Lists. Try using a Condition Group instead"
                          }
                          tipPosition="top"
                        >
                          unsupported datatype
                        </Tooltip>
                      </span>
                    )}
                  </div>
                );
              }}
              helpText={current.attributeKey && "This field cannot be edited."}
            />
            {!current.id && type === "list" && (
              <IdListItemInput
                values={form.watch("values") || []}
                setValues={(newValues) => {
                  form.setValue("values", newValues);
                }}
                openUpgradeModal={() => setUpgradeModal(true)}
                listAboveSizeLimit={listAboveSizeLimit}
                bypassSizeLimit={adminBypassSizeLimit}
                setBypassSizeLimit={setAdminBypassSizeLimit}
                projects={form.watch("projects")}
              />
            )}
          </>
        ))}
    </Modal>
  );

  return upgradeModal ? (
    <UpgradeModal
      close={() => setUpgradeModal(false)}
      source="large-saved-groups"
      commercialFeature="large-saved-groups"
    />
  ) : (
    <ConflictProvider {...conflict.providerProps}>
      {modalContent}
    </ConflictProvider>
  );
};
export default SavedGroupForm;
