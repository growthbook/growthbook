import { FC, useEffect, useMemo, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
  SavedGroupInterface,
  SavedGroupType,
} from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import { useForm } from "react-hook-form";
import {
  isIdListSupportedAttribute,
  validateAndFixCondition,
} from "shared/util";
import { PiPlus } from "react-icons/pi";
import clsx from "clsx";
import { Flex, Text } from "@radix-ui/themes";
import { useIncrementer } from "@/hooks/useIncrementer";
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
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import Link from "@/ui/Link";
import SelectOwner from "@/components/Owner/SelectOwner";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";

type SavedGroupFormValues = CreateSavedGroupProps;
import useProjectOptions from "@/hooks/useProjectOptions";

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  type: SavedGroupType;
  approvalFlowRequired?: boolean;
  metadataReviewRequired?: boolean;
  hasExistingRevision?: boolean;
  onRevisionCreated?: (revision: Revision) => void;
  openRevisions?: Revision[];
  allRevisions?: Revision[];
  selectedRevision?: Revision | null;
  onSelectRevision?: (revision: Revision | null) => void;
  liveVersion?: SavedGroupInterface;
  isCreatingNewRevision?: boolean;
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
  hasExistingRevision,
  onRevisionCreated,
  openRevisions = [],
  allRevisions,
  selectedRevision,
  onSelectRevision,
  liveVersion,
  isCreatingNewRevision = false,
  editInfoOnly = false,
  editConditionOnly = false,
  autoBypassApproval = false,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const { savedGroupSizeLimit } = settings;
  const { user, getUserDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // Compute approvalFlowRequired from settings if not provided as prop
  const isApprovalFlowRequired =
    approvalFlowRequired ??
    settings.approvalFlows?.savedGroups?.required ??
    false;

  // Compute metadataReviewRequired from settings if not provided as prop
  const isMetadataReviewRequired =
    metadataReviewRequired ??
    (isApprovalFlowRequired &&
      (settings.approvalFlows?.savedGroups?.requireMetadataReview ?? true));

  const canAdminPublish =
    !!isApprovalFlowRequired &&
    !!current.id &&
    (user?.role === "admin" ||
      (current.projects?.length
        ? current.projects.every((project) =>
            permissionsUtil.canBypassApprovalChecks({ project: project || "" }),
          )
        : permissionsUtil.canBypassApprovalChecks({ project: "" })));

  const [bypassApproval, setBypassApproval] = useState(autoBypassApproval);
  const [conditionKey, forceConditionRender] = useIncrementer();
  const [internalSelectedRevision, _setInternalSelectedRevision] =
    useState<Revision | null>(selectedRevision ?? null);

  const attributeSchema = useAttributeSchema();

  // Use controlled or internal state for selected revision
  const currentRevision =
    onSelectRevision !== undefined
      ? (selectedRevision ?? null)
      : internalSelectedRevision;

  // Check if editing is blocked
  // 1. Editing live version while there are open revisions (unless creating new or auto-publishing)
  // 2. Viewing a discarded/merged revision (read-only) - only when metadata review is required
  const isEditBlocked =
    (!!current.id &&
      openRevisions.length > 0 &&
      !currentRevision &&
      !isCreatingNewRevision &&
      !autoBypassApproval) ||
    (isMetadataReviewRequired &&
      (currentRevision?.status === "discarded" ||
        currentRevision?.status === "merged"));

  const { mutateDefinitions, savedGroups, project } = useDefinitions();

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
      projects: current.projects || (project ? [project] : []),
    },
  });

  // Update form values when selected revision changes OR when current prop updates
  useEffect(() => {
    let baseData: Partial<SavedGroupInterface>;

    if (currentRevision) {
      // If a draft revision is selected, use its snapshot + proposed changes
      baseData = {
        ...(currentRevision.target.snapshot as SavedGroupInterface),
        ...(currentRevision.target
          .proposedChanges as Partial<SavedGroupInterface>),
      };
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
      projects: baseData.projects || (project ? [project] : []),
    };

    // Only reset if values actually changed to avoid unnecessary re-renders
    if (JSON.stringify(currentFormValues) !== JSON.stringify(newValues)) {
      form.reset(newValues);
    }

    if (baseData.description) {
      setShowDescription(true);
    }
  }, [currentRevision, liveVersion, type, project, form, current]);

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
    ? isMetadataReviewRequired &&
      (currentRevision?.status === "closed" ||
        currentRevision?.status === "merged")
      ? "This revision is discarded and cannot be edited."
      : "Cannot edit while there are open draft revisions."
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
      useRadixButton={true}
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
        <>
          {current.id
            ? isApprovalFlowRequired
              ? bypassApproval || autoBypassApproval
                ? "Publish"
                : currentRevision
                  ? "Update revision"
                  : hasExistingRevision
                    ? "Propose changes"
                    : "Propose changes"
              : "Save"
            : "Submit"}
        </>
      }
      ctaEnabled={
        isValid && (editConditionOnly || hasProjectPermission) && !isEditBlocked
      }
      disabledMessage={ctaDisabledMessage}
      backCTA={
        <div className="mt-3 mb-2">
          {current.id && !autoBypassApproval && (
            <Checkbox
              label="Bypass approval requirement to publish (optional for Admins only)"
              value={bypassApproval}
              setValue={(val) => setBypassApproval(!!val)}
              disabled={!canAdminPublish}
              disabledMessage="You don't have permission to bypass approval"
            />
          )}
        </div>
      }
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
          );
          if (conditionRes.empty) {
            throw new Error("Condition cannot be empty");
          }
        }

        // Update existing saved group
        if (current.id) {
          const payload: UpdateSavedGroupProps = editInfoOnly
            ? {
                groupName: value.groupName,
                owner: value.owner,
                description: value.description,
                projects: value.projects,
              }
            : editConditionOnly
              ? {
                  condition: value.condition,
                }
              : {
                  condition: value.condition,
                  groupName: value.groupName,
                  owner: value.owner,
                  values: value.values,
                  description: value.description,
                  projects: value.projects,
                };

          // Build URL with query params
          const params = new URLSearchParams();

          // If auto-bypassing (metadata review is off), request auto-publish
          if (autoBypassApproval) {
            params.set("autoPublish", "1");
          } else if (bypassApproval) {
            params.set("bypassApproval", "1");
          }

          if (currentRevision?.id && !autoBypassApproval) {
            params.set("revisionId", currentRevision.id);
          } else if (!autoBypassApproval) {
            // Always create a revision when there's no current revision to update
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
              // When auto-published, refresh the saved group data
              mutate?.();
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
      })}
      error={errorMessage}
    >
      {isEditBlocked && (
        <Callout status="warning" mb="4">
          <Text size="2">
            {isMetadataReviewRequired &&
            (currentRevision?.status === "closed" ||
              currentRevision?.status === "merged")
              ? `This revision is ${currentRevision.status} and cannot be edited. You can view it here in read-only mode.`
              : "You cannot edit this saved group directly because there are open draft revisions. Please select a draft revision from the main page to edit, or wait for all drafts to be published or discarded."}
          </Text>
        </Callout>
      )}
      {!autoBypassApproval &&
        current.id &&
        openRevisions.length > 0 &&
        currentRevision &&
        (() => {
          const allFlows = allRevisions ?? openRevisions;
          const sortedFlows = [...allFlows].sort(
            (a, b) =>
              new Date(a.dateCreated).getTime() -
              new Date(b.dateCreated).getTime(),
          );
          const revisionNum =
            sortedFlows.findIndex((f) => f.id === currentRevision.id) + 1;

          const statusLabels = {
            pending: "Pending Review",
            approved: "Approved",
            "changes-requested": "Changes Requested",
            rejected: "Rejected",
          };

          const tooltipContent = (
            <Flex direction="column" gap="1">
              <Text size="2">
                <strong>Created by:</strong>{" "}
                {getUserDisplay(currentRevision.authorId)}
              </Text>
              <Text size="2">
                <strong>Status:</strong>{" "}
                {statusLabels[currentRevision.status] || currentRevision.status}
              </Text>
            </Flex>
          );

          return (
            <Callout status="info" mb="4">
              <Flex direction="row" gap="2" align="center">
                <Text size="2" weight="medium">
                  Editing revision:
                </Text>
                <Tooltip body={tooltipContent}>
                  <Badge label={`Revision ${revisionNum}`} color="indigo" />
                </Tooltip>
              </Flex>
            </Callout>
          );
        })()}
      {!editInfoOnly && !editConditionOnly && current.type === "condition" && (
        <div className="form-group">
          Updating this group will automatically update any associated Features
          and Experiments.
        </div>
      )}
      {!editConditionOnly && (
        <>
          <Field
            label={`${type === "list" ? "List" : "Group"} Name`}
            labelClassName="font-weight-bold"
            required
            {...form.register("groupName")}
            placeholder="e.g. beta-users or internal-team-members"
          />
          {showDescription ? (
            <Field
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
