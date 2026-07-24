import { FC, useEffect, useMemo, useState } from "react";
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
} from "shared/enterprise";
import { useForm } from "react-hook-form";
import { isEqual } from "lodash";
import {
  isIdListSupportedAttribute,
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
import SavedGroupDraftSelectorForChanges, {
  DraftMode,
} from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";

import useProjectOptions from "@/hooks/useProjectOptions";

type SavedGroupFormValues = CreateSavedGroupProps;

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
  autoBypassApproval?: boolean;
  mutate?: () => void;
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
  autoBypassApproval = false,
  mutate,
}) => {
  const { apiCall, orgId } = useAuth();
  const settings = useOrgSettings();
  const { savedGroupSizeLimit } = settings;
  const { user } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // Compute approvalFlowRequired from settings if not provided as prop
  const isApprovalFlowRequired =
    approvalFlowRequired ??
    settings.approvalFlows?.savedGroups?.[0]?.required ??
    false;

  // Compute metadataReviewRequired from settings if not provided as prop
  const isMetadataReviewRequired =
    metadataReviewRequired ??
    (isApprovalFlowRequired &&
      (settings.approvalFlows?.savedGroups?.[0]?.requireMetadataReview ??
        true));

  const canAdminPublish =
    !!isApprovalFlowRequired &&
    !!current.id &&
    (user?.role === "admin" ||
      (current.projects?.length
        ? current.projects.every((project) =>
            permissionsUtil.canBypassApprovalChecks({ project: project || "" }),
          )
        : permissionsUtil.canBypassApprovalChecks({ project: "" })));

  const canAutoPublish = !isApprovalFlowRequired || canAdminPublish;

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
  const [internalSelectedRevision, _setInternalSelectedRevision] =
    useState<Revision | null>(selectedRevision ?? null);

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

  const { mutateDefinitions, project } = useDefinitions();

  // /organization/definitions drops `condition` to keep the payload small, so
  // cycle detection needs the condition-bearing /saved-groups list instead.
  const { data: savedGroupsData } = useApi<{
    savedGroups: SavedGroupWithoutValues[];
  }>("/saved-groups");
  const savedGroups = useMemo(
    () => savedGroupsData?.savedGroups ?? [],
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

  // Update form values when selected revision changes OR when current prop updates
  useEffect(() => {
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
  }, [currentRevision, liveVersion, type, project, orgId, form, current]);

  const selectedProjects = form.watch("projects") || [];
  const projectsOptions = useProjectOptions(
    (p) =>
      current.id
        ? permissionsUtil.canUpdateSavedGroup(
            { projects: current.projects || [] },
            { projects: [p] },
          )
        : permissionsUtil.canCreateSavedGroup({ projects: [p] }),
    selectedProjects,
  );
  const canCreateWithoutProject = current.id
    ? permissionsUtil.canUpdateSavedGroup(
        { projects: current.projects || [] },
        { projects: [] },
      )
    : permissionsUtil.canCreateSavedGroup({ projects: [] });
  const hasProjectPermission = current.id
    ? permissionsUtil.canUpdateSavedGroup(
        { projects: current.projects || [] },
        { projects: selectedProjects },
      )
    : permissionsUtil.canCreateSavedGroup({ projects: selectedProjects });
  const listAboveSizeLimit = savedGroupSizeLimit
    ? (form.watch("values") ?? []).length > savedGroupSizeLimit
    : false;
  const isValid = editInfoOnly
    ? !!form.watch("groupName")
    : editConditionOnly
      ? !!form.watch("condition")
      : !!form.watch("groupName") &&
        (type === "list"
          ? !!form.watch("attributeKey") &&
            (!listAboveSizeLimit || adminBypassSizeLimit)
          : !!form.watch("condition"));

  const ctaDisabledMessage = isEditBlocked
    ? "This revision is discarded and cannot be edited."
    : !hasProjectPermission && !editConditionOnly
      ? !selectedProjects.length && projectsOptions.length > 0
        ? "Select a project to continue."
        : `You don't have permission to ${current.id ? "update" : "create"} saved groups.`
      : !isValid
        ? editConditionOnly
          ? !form.watch("condition")
            ? "Add a condition to continue."
            : undefined
          : !form.watch("groupName")
            ? "Enter a name to continue."
            : editInfoOnly
              ? undefined
              : type === "list"
                ? !form.watch("attributeKey")
                  ? "Select an attribute key to continue."
                  : listAboveSizeLimit && !adminBypassSizeLimit
                    ? "List size exceeds limit. Enable bypass or reduce size."
                    : undefined
                : !form.watch("condition")
                  ? "Add a condition to continue."
                  : undefined
        : undefined;

  // Create a Map from saved groups for cycle detection
  const groupMap = useMemo(
    () => new Map(savedGroups.map((group) => [group.id, group])),
    [savedGroups],
  );

  return upgradeModal ? (
    <UpgradeModal
      close={() => setUpgradeModal(false)}
      source="large-saved-groups"
      commercialFeature="large-saved-groups"
    />
  ) : (
    <Modal
      trackingEventModalType="saved-group-form"
      close={close}
      open={true}
      size="lg"
      header={
        editInfoOnly
          ? "Edit Information"
          : editConditionOnly
            ? "Edit Condition"
            : `${current.id ? "Edit" : "Add"} ${
                type === "condition" ? "Condition Group" : "ID List"
              }`
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
        isValid && (editConditionOnly || hasProjectPermission) && !isEditBlocked
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
            // /saved-groups loads async and starts out empty, which would
            // make every $savedGroups reference look unknown; skip the
            // client-side cycle check until it arrives (the backend still
            // validates on submit).
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
            !isEqual(value[k] ?? null, baseline(k) ?? null);
          const payload: UpdateSavedGroupProps = editInfoOnly
            ? {
                ...(fieldChanged("groupName")
                  ? { groupName: value.groupName }
                  : {}),
                ...(fieldChanged("owner") ? { owner: value.owner } : {}),
                ...(fieldChanged("description")
                  ? { description: value.description }
                  : {}),
                ...(fieldChanged("projects")
                  ? { projects: value.projects }
                  : {}),
              }
            : editConditionOnly
              ? fieldChanged("condition")
                ? { condition: value.condition }
                : {}
              : {
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
                  ...(fieldChanged("projects")
                    ? { projects: value.projects }
                    : {}),
                };

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

          const res = await apiCall<{
            status: number;
            requiresApproval?: boolean;
            revision?: Revision;
          }>(url, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

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
        else {
          const payload: CreateSavedGroupProps = {
            ...value,
          };
          setErrorMessage("");
          await apiCall(
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
        }
        mutateDefinitions({});
        await mutate?.();
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
        />
      )}
      {isEditBlocked && currentRevision && (
        <Callout status="warning" mb="4">
          <Text size="2">
            {`This revision is ${currentRevision.status} and cannot be edited. You can view it here in read-only mode.`}
          </Text>
        </Callout>
      )}
      {!editInfoOnly && !editConditionOnly && current.type === "condition" && (
        <div className="form-group">
          Updating this group will automatically update any associated Features
          and Experiments.
        </div>
      )}
      {!editConditionOnly && (
        <>
          <Field
            size="legacy"
            label={`${type === "list" ? "List" : "Group"} Name`}
            labelClassName="font-weight-bold"
            required
            {...form.register("groupName")}
            placeholder="e.g. beta-users or internal-team-members"
          />
          {showDescription ? (
            <Field
              size="legacy"
              label="Description"
              labelClassName="font-weight-bold"
              required={false}
              textarea
              maxLength={100}
              value={form.watch("description")}
              onChange={(e) => {
                form.setValue("description", e.target.value);
              }}
            />
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
            size="legacy"
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
          {current.id && (
            <SelectOwner
              placeholder="Optional"
              value={form.watch("owner")}
              onChange={(v) => form.setValue("owner", v)}
            />
          )}
        </>
      )}

      {!editInfoOnly &&
        (type === "condition" ? (
          <ConditionInput
            defaultValue={form.watch("condition") || ""}
            onChange={(v) => {
              form.setValue("condition", v);
            }}
            project={selectedProjects[0] || ""}
            key={conditionKey}
          />
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
              options={attributeSchema.map((a) => ({
                value: a.property,
                label: a.property,
              }))}
              isOptionDisabled={({ label }) => {
                const attr = attributeSchema.find(
                  (attr) => attr.property === label,
                );
                if (!attr) return false;
                return !isIdListSupportedAttribute(attr);
              }}
              sort={false}
              formatOptionLabel={({ label }) => {
                const attr = attributeSchema.find(
                  (attr) => attr.property === label,
                );
                if (!attr) return label;
                const unsupported = !isIdListSupportedAttribute(attr);
                return (
                  <div className={clsx(unsupported ? "disabled" : "")}>
                    {label}
                    {unsupported && (
                      <span className="float-right">
                        <Tooltip
                          body="The datatype for this attribute key isn't valid for ID Lists. Try using a Condition Group instead"
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
            {!current.id && (
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
};
export default SavedGroupForm;
