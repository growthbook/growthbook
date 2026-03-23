import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import { ago } from "shared/dates";
import { FaPlusCircle } from "react-icons/fa";
import { PiArrowsDownUp } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { isIdListSupportedAttribute } from "shared/util";
import { Box, Card, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  renderSavedGroupTargeting,
  renderSavedGroupProjects,
  renderSavedGroupSettings,
  getSavedGroupSettingsBadges,
  getSavedGroupTargetingBadges,
  getSavedGroupValuesBadges,
  getSavedGroupProjectsBadges,
} from "@/components/SavedGroups/SavedGroupDiffRenders";
import { DocLink } from "@/components/DocLink";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupReferences from "@/components/SavedGroups/SavedGroupReferences";
import SavedGroupReferencesList from "@/components/SavedGroups/SavedGroupReferencesList";
import Checkbox from "@/ui/Checkbox";
import SavedGroupDeleteModal from "@/components/SavedGroups/SavedGroupDeleteModal";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RevisionDetail from "@/components/Revision/RevisionDetail";
import RevisionVersionSelector from "@/components/Revision/RevisionVersionSelector";
import { useSavedGroupRevision } from "@/hooks/useSavedGroupRevision";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";
import { useUser } from "@/services/UserContext";

const NUM_PER_PAGE = 10;

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`,
  );
  const savedGroup = data?.savedGroup;
  const [sortNewestFirst, setSortNewestFirst] = useState<boolean>(true);
  const [addItems, setAddItems] = useState<boolean>(false);
  const [itemsToAdd, setItemsToAdd] = useState<string[]>([]);
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const [showReferencesModal, setShowReferencesModal] =
    useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [showChangesModal, setShowChangesModal] = useState<boolean>(false);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);
  const [isCreatingNewRevision, setIsCreatingNewRevision] =
    useState<boolean>(false);
  const [confirmRevert, setConfirmRevert] = useState<boolean>(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const settings = useOrgSettings();
  const { savedGroupSizeLimit, attributeSchema } = settings;

  const { references } = useSavedGroupReferences(savedGroup?.id);
  const referencingFeatures = references?.features ?? [];
  const referencingExperiments = references?.experiments ?? [];
  const referencingSavedGroups = references?.savedGroups ?? [];
  const totalReferences =
    referencingFeatures.length +
    referencingExperiments.length +
    referencingSavedGroups.length;

  const values = useMemo(() => savedGroup?.values ?? [], [savedGroup]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState("");

  const { apiCall } = useAuth();
  const [importOperation, setImportOperation] = useState<"replace" | "append">(
    "replace",
  );
  const { projects } = useDefinitions();

  const revisionRequired =
    settings.approvalFlows?.savedGroups?.required ?? false;

  const revisionState = useSavedGroupRevision(savedGroup?.id, mutate);
  const {
    selectedApprovalFlow: selectedRevision,
    selectedApprovalFlowId: selectedRevisionId,
    openApprovalFlows: openRevisions,
    allApprovalFlows: allRevisions,
    selectFlow,
    onApprovalFlowCreated: onRevisionCreated,
    handleDiscard,
    handlePublish,
    handleReopen,
    mutateApprovalFlows: mutateRevisions,
    userOpenFlow: userOpenRevision,
  } = revisionState;

  // When the user already has an open revision, block edits to the live version
  const editBlocked = revisionRequired && !!userOpenRevision;

  // Close the changes modal when the selected revision is deselected (e.g. after publish/discard)
  useEffect(() => {
    if (!selectedRevision) {
      setShowChangesModal(false);
    }
  }, [selectedRevision]);

  // When a revision is selected, show its proposed state in the overview
  const displayedSavedGroup = useMemo(() => {
    if (!selectedRevision) return savedGroup;
    return {
      ...selectedRevision.target.snapshot,
      ...selectedRevision.target.proposedChanges,
    } as SavedGroupInterface;
  }, [selectedRevision, savedGroup]);

  const displayedValues = useMemo(
    () => displayedSavedGroup?.values ?? [],
    [displayedSavedGroup],
  );

  const filteredValues = displayedValues.filter((v) => v.match(filter));
  const sortedValues = sortNewestFirst
    ? filteredValues.reverse()
    : filteredValues;

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = sortedValues.slice(start, end);
  const [importOperation, setImportOperation] = useState<"replace" | "append">(
    "replace",
  );
  const { attributeSchema } = useOrgSettings();
  const { projects } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const { hasLargeSavedGroupFeature, unsupportedConnections } =
    useLargeSavedGroupSupport();

  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mutateValues = useCallback(
    (newValues: string[]) => {
      if (!savedGroup) return;
      mutate({
        savedGroup: {
          ...savedGroup,
          values: newValues,
        },
      });
    },
    [mutate, savedGroup],
  );

  const attr = (attributeSchema || []).find(
    (attr) => attr.property === savedGroup?.attributeKey,
  );

  const listAboveSizeLimit = useMemo(
    () =>
      savedGroupSizeLimit
        ? [...new Set(itemsToAdd.concat(values))].length > savedGroupSizeLimit
        : false,
    [savedGroupSizeLimit, itemsToAdd, values],
  );
  const revisionNumber = useMemo(() => {
    if (!selectedRevision)
      return allRevisions.findIndex((f) => f.id === userOpenRevision?.id) + 1;
    return allRevisions.findIndex((f) => f.id === selectedRevision.id) + 1;
  }, [selectedRevision, allRevisions, userOpenRevision]);

  if (!data || !savedGroup) {
    return <LoadingOverlay />;
  }

  if (error) {
    return (
      <Callout status="error" mt="4">
        An error occurred: {error.message}
      </Callout>
    );
  }

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="large-saved-groups"
          commercialFeature="large-saved-groups"
        />
      )}
      {showDeleteModal && savedGroup && (
        <SavedGroupDeleteModal
          savedGroup={savedGroup}
          close={() => setShowDeleteModal(false)}
          onDelete={async () => {
            await apiCall(`/saved-groups/${savedGroup.id}`, {
              method: "DELETE",
            });
            router.push("/saved-groups");
          }}
        />
      )}
      {showAuditModal && savedGroup && (
        <AuditHistoryExplorerModal<SavedGroupInterface>
          entityId={savedGroup.id}
          entityName="Saved Group"
          config={{
            entityType: "savedGroup",
            includedEvents: ["savedGroup.created", "savedGroup.updated"],
            alwaysVisibleEvents: ["savedGroup.created"],
            labelOnlyEvents: [
              {
                event: "savedGroup.deleted",
                getLabel: () => "Deleted",
                alwaysVisible: true,
              },
            ],
            sections: [
              {
                label: "Settings",
                keys: ["groupName", "owner", "description"],
                render: renderSavedGroupSettings,
                getBadges: getSavedGroupSettingsBadges,
              },
              {
                label: "Targeting",
                keys: ["condition"],
                render: renderSavedGroupTargeting,
                getBadges: getSavedGroupTargetingBadges,
              },
              {
                label: "Values",
                keys: ["values", "attributeKey"],
                getBadges: getSavedGroupValuesBadges,
              },
              {
                label: "Projects",
                keys: ["projects"],
                render: renderSavedGroupProjects,
                getBadges: getSavedGroupProjectsBadges,
              },
            ],
            updateEventNames: ["savedGroup.updated"],
            defaultGroupBy: "minute",
            hideFilters: true,
            hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
            normalizeSnapshot: (snapshot) => {
              if (!snapshot || typeof snapshot !== "object") return snapshot;
              let result = { ...snapshot };
              if (
                "condition" in result &&
                typeof result.condition === "string"
              ) {
                try {
                  result = {
                    ...result,
                    condition: JSON.parse(result.condition),
                  };
                } catch {
                  // leave as-is if unparseable
                }
              }
              if ("values" in result && Array.isArray(result.values)) {
                const vals = result.values as string[];
                const LIMIT = 100;
                if (vals.length > LIMIT) {
                  result = {
                    ...result,
                    values: [
                      ...vals.slice(0, LIMIT),
                      `— ${vals.length - LIMIT} more values...`,
                    ],
                  };
                }
              }
              return result;
            },
          }}
          onClose={() => setShowAuditModal(false)}
        />
      )}
      {addItems && (
        <Modal
          trackingEventModalType={`edit-saved-group-${importOperation}-items`}
          close={() => {
            setAddItems(false);
            setItemsToAdd([]);
          }}
          open={addItems}
          size="lg"
          header={
            importOperation === "append"
              ? "Add List Items"
              : "Overwrite List Contents"
          }
          cta={
            revisionRequired
              ? userOpenRevision
                ? "Update"
                : "Propose changes"
              : "Save"
          }
          ctaEnabled={
            itemsToAdd.length > 0 &&
            (!listAboveSizeLimit || adminBypassSizeLimit)
          }
          submit={async () => {
            if (importOperation === "append") {
              const res = await apiCall<{
                status: number;
                requiresApproval?: boolean;
                revision?: import("shared/enterprise").Revision;
              }>(`/saved-groups/${savedGroup.id}/add-items`, {
                method: "POST",
                body: JSON.stringify({
                  items: itemsToAdd,
                }),
              });
              if (res?.requiresApproval) {
                if (res.revision) {
                  onRevisionCreated(res.revision);
                }
                setItemsToAdd([]);
                return;
              }
              const newValues = new Set([...values, ...itemsToAdd]);
              mutateValues([...newValues]);
            } else {
              const res = await apiCall<{
                status: number;
                requiresApproval?: boolean;
                revision?: import("shared/enterprise").Revision;
              }>(`/saved-groups/${savedGroup.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  values: itemsToAdd,
                }),
              });
              if (res?.requiresApproval) {
                if (res.revision) {
                  onRevisionCreated(res.revision);
                }
                setItemsToAdd([]);
                return;
              }
              const newValues = new Set(itemsToAdd);
              mutateValues([...newValues]);
            }
            setItemsToAdd([]);
          }}
        >
          <>
            <div className="form-group">
              Updating this list will automatically update any associated
              Features and Experiments.
            </div>
            <IdListItemInput
              values={itemsToAdd}
              setValues={(newValues) => setItemsToAdd(newValues)}
              openUpgradeModal={() => setUpgradeModal(true)}
              listAboveSizeLimit={listAboveSizeLimit}
              bypassSizeLimit={adminBypassSizeLimit}
              setBypassSizeLimit={setAdminBypassSizeLimit}
              projects={savedGroup.projects}
            />
          </>
        </Modal>
      )}
      {savedGroupForm && (
        <SavedGroupForm
          close={() => {
            setSavedGroupForm(null);
            setIsCreatingNewRevision(false);
            mutate();
          }}
          current={savedGroupForm}
          type={savedGroup.type}
          approvalFlowRequired={revisionRequired}
          hasExistingRevision={!!userOpenRevision}
          onRevisionCreated={onRevisionCreated}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          isCreatingNewRevision={isCreatingNewRevision}
        />
      )}
      {showReferencesModal && (
        <Modal
          header={`'${savedGroup.groupName}' References`}
          trackingEventModalType="show-saved-group-references"
          close={() => setShowReferencesModal(false)}
          open={showReferencesModal}
          useRadixButton={true}
          closeCta="Close"
        >
          <Text as="p" mb="3">
            This saved group is referenced by the following features,
            experiments, and saved groups.
          </Text>
          <SavedGroupReferencesList
            features={referencingFeatures}
            experiments={referencingExperiments}
            savedGroups={referencingSavedGroups}
          />
        </Modal>
      )}
      {showChangesModal && selectedRevision && (
        <Modal
          header="Revision Changes"
          trackingEventModalType="saved-group-revision-changes"
          close={() => setShowChangesModal(false)}
          open={showChangesModal}
          dismissible
          size="max"
          hideCta={true}
          closeCta="Close"
          useRadixButton={true}
        >
          <RevisionDetail<SavedGroupInterface>
            diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
            revision={selectedRevision}
            currentState={savedGroup}
            mutate={() => {
              mutateRevisions();
              mutate();
            }}
            setCurrentRevision={(f) => selectFlow(f)}
            onDiscard={async (revisionId) => {
              await handleDiscard(revisionId);
              setShowChangesModal(false);
            }}
            onPublish={async (revisionId) => {
              await handlePublish(revisionId);
              setShowChangesModal(false);
            }}
            onReopen={async (revisionId) => {
              await handleReopen(revisionId);
            }}
            allRevisions={allRevisions}
          />
        </Modal>
      )}
      {confirmRevert && revisionToRevert && (
        <Modal
          header="Revert Merged Revision"
          trackingEventModalType="revert-revision"
          close={() => {
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
          open={confirmRevert}
          cta="Create Revert Revision"
          submitColor="primary"
          submit={async () => {
            // Create a new revision that reverts the merged changes
            const snapshot = revisionToRevert.target
              .snapshot as SavedGroupInterface;
            const proposedChanges = revisionToRevert.target
              .proposedChanges as Record<string, unknown>;

            // Calculate reverse changes: from current live state back to the snapshot
            const reverseChanges: Record<string, unknown> = {};

            // For each field that was changed in the merged revision,
            // create a reverse change that goes back to the original value
            Object.keys(proposedChanges).forEach((key) => {
              const originalValue = snapshot[key as keyof SavedGroupInterface];
              reverseChanges[key] = originalValue;
            });

            // Get the revision number for the title
            const sortedRevisions = [...allRevisions].sort(
              (a, b) =>
                new Date(a.dateCreated).getTime() -
                new Date(b.dateCreated).getTime(),
            );
            const revisionNumber =
              sortedRevisions.findIndex((r) => r.id === revisionToRevert.id) +
              1;
            const title = `Revert to Revision ${revisionNumber}`;

            // Create a new revision with the reverse changes, title, and link back to original
            const res = await apiCall<{
              status: number;
              requiresApproval?: boolean;
              revision?: Revision;
            }>(
              `/saved-groups/${savedGroup.id}?forceCreateRevision=1&title=${encodeURIComponent(title)}&revertedFrom=${revisionToRevert.id}`,
              {
                method: "PUT",
                body: JSON.stringify(reverseChanges),
              },
            );

            if (res?.revision) {
              onRevisionCreated(res.revision);
              selectFlow(res.revision);
            }

            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
        >
          <Text>
            This will create a new revision that reverts all changes from the
            selected merged revision, restoring the saved group to its state
            before that revision was merged.
          </Text>
          <Text mt="3" weight="medium">
            The new revision will need to be reviewed and approved before being
            published.
          </Text>
        </Modal>
      )}
      <PageHead
        breadcrumb={[
          { display: "Saved Groups", href: "/saved-groups" },
          { display: savedGroup.groupName },
        ]}
      />
      <div className="p-3 container-fluid pagecontents">
        <Flex align="center" justify="between" mb="4">
          <Heading size="7" as="h1">
            {savedGroup.groupName}
          </Heading>
          <Flex gap="6" direction="row" align="center">
            {revisionRequired && (
              <RevisionVersionSelector
                openRevisions={openRevisions}
                allRevisions={allRevisions}
                selectedRevisionId={selectedRevisionId}
                onSelectRevision={selectFlow}
                onCreateNewRevision={() => {
                  // Create a new revision based on the LIVE version
                  // Old revisions will remain unchanged
                  setIsCreatingNewRevision(true);
                  setSavedGroupForm(savedGroup);
                  selectFlow(null);
                }}
              />
            )}
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                >
                  <BsThreeDotsVertical size={18} />
                </IconButton>
              }
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
              menuPlacement="end"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setIsCreatingNewRevision(false);
                    if (!selectedRevision && userOpenRevision) {
                      // Switch to the user's open revision so edits stack on it
                      selectFlow(userOpenRevision);
                      setSavedGroupForm({
                        ...userOpenRevision.target.snapshot,
                        ...userOpenRevision.target.proposedChanges,
                      } as SavedGroupInterface);
                    } else {
                      setSavedGroupForm(displayedSavedGroup ?? savedGroup);
                    }
                    setDropdownOpen(false);
                  }}
                >
                  Edit {selectedRevision && `Revision ${revisionNumber}`}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setShowAuditModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  View Audit Log
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  color="red"
                  onClick={() => {
                    setShowDeleteModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenu>
          </Flex>
        </Flex>
        <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
          <Flex align="center" gap="4" wrap="wrap">
            {savedGroup.type === "list" && (
              <Text>
                Attribute Key: <strong>{savedGroup.attributeKey}</strong>
              </Text>
            )}
            {(projects.length > 0 ||
              (savedGroup.projects?.length ?? 0) > 0) && (
              <Flex align="center" gap="2">
                <Text>Projects:</Text>
                {(savedGroup.projects?.length || 0) > 0 ? (
                  <ProjectBadges
                    projectIds={savedGroup.projects}
                    resourceType="saved group"
                  />
                ) : (
                  <ProjectBadges resourceType="saved group" />
                )}
              </Flex>
            )}
            <Text>
              Date Updated: <strong>{ago(savedGroup.dateUpdated)}</strong>
            </Text>
            <Text>
              Owner:{" "}
              <strong>{getOwnerDisplay(savedGroup.owner) || "None"}</strong>
            </Text>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            <SavedGroupReferences
              totalReferences={totalReferences}
              onShowReferences={() => setShowReferencesModal(true)}
            />
          </Flex>
        </Flex>
        {savedGroup.description && (
          <Text as="p" mb="3">
            {savedGroup.description}
          </Text>
        )}
        {savedGroup.type === "list" && !isIdListSupportedAttribute(attr) && (
          <Callout status="error" mt="3">
            The attribute for this saved group has an unsupported datatype. It
            cannot be edited and it may produce unexpected behavior when used in
            SDKs. Try using a{" "}
            <Link href="/saved-groups#conditionGroups">Condition Group</Link>{" "}
            instead
          </Callout>
        )}
        {!selectedRevision && userOpenRevision && (
          <Callout status="info" mb="3">
            You are seeing the live version, but you have a revision in
            progress.{" "}
            <Link href={`/saved-groups/${sgid}?flow=${userOpenRevision.id}`}>
              View your open revision
            </Link>
          </Callout>
        )}
        {selectedRevision && (
          <Callout
            status={
              selectedRevision.status === "approved"
                ? "success"
                : selectedRevision.status === "changes-requested"
                  ? "warning"
                  : selectedRevision.status === "closed"
                    ? "warning"
                    : selectedRevision.status === "merged"
                      ? "success"
                      : "info"
            }
            mb="3"
          >
            <Flex align="center" justify="between" gap="3">
              <Box flexGrow="1">
                {selectedRevision.status === "approved"
                  ? "This revision has been approved and is ready to publish."
                  : selectedRevision.status === "changes-requested"
                    ? "Changes have been requested on this revision."
                    : selectedRevision.status === "closed"
                      ? "This revision was closed."
                      : selectedRevision.status === "merged"
                        ? "This revision has been merged and published."
                        : "This revision is pending review."}
              </Box>
              {selectedRevision.status === "closed" ? (
                <Button
                  onClick={() => handleReopen(selectedRevision.id)}
                  my="-2"
                >
                  Reopen
                </Button>
              ) : selectedRevision.status === "merged" ? (
                <Flex gap="2">
                  <Button
                    onClick={() => setShowChangesModal(true)}
                    my="-2"
                    variant="ghost"
                  >
                    See changes
                  </Button>
                  <Button
                    onClick={() => {
                      setRevisionToRevert(selectedRevision);
                      setConfirmRevert(true);
                    }}
                    my="-2"
                  >
                    Revert
                  </Button>
                </Flex>
              ) : (
                <Button onClick={() => setShowChangesModal(true)} my="-2">
                  See changes
                </Button>
              )}
            </Flex>
          </Callout>
        )}
        {savedGroup.type === "list" && (
          <LargeSavedGroupPerformanceWarning
            hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
            unsupportedConnections={unsupportedConnections}
            openUpgradeModal={() => setUpgradeModal(true)}
          />
        )}
        {savedGroup.type === "condition" ? (
          <>
            <Heading size="4" mb="3">
              Condition
            </Heading>
            <Text as="p" mb="3">
              Include all users who match the following:
            </Text>
            <Card mb="4">
              <Flex direction="row" gap="2" p="2">
                <Text weight="medium">IF</Text>
                <Box>
                  <ConditionDisplay
                    condition={displayedSavedGroup?.condition || ""}
                    savedGroups={[]}
                  />
                </Box>
              </Flex>
            </Card>
          </>
        ) : (
          <>
            <Flex align="center" justify="between" mb="3" gap="4">
              <Box className="relative" width="40%">
                <Field
                  placeholder="Search..."
                  type="search"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                  }}
                />
              </Box>
              <Flex gap="4" align="center">
                {selected.size > 0 && (
                  <DeleteButton
                    text={`Delete Selected (${selected.size})`}
                    title={`Delete selected item${selected.size > 1 ? "s" : ""}`}
                    disabled={editBlocked}
                    getConfirmationContent={async () => ""}
                    onClick={async () => {
                      const res = await apiCall<{
                        status: number;
                        requiresApproval?: boolean;
                        revision?: import("shared/enterprise").Revision;
                      }>(`/saved-groups/${savedGroup.id}/remove-items`, {
                        method: "POST",
                        body: JSON.stringify({ items: [...selected] }),
                      });
                      if (res?.requiresApproval) {
                        if (res.revision) {
                          onRevisionCreated(res.revision);
                        }
                        setSelected(new Set());
                        return;
                      }
                      const newValues = values.filter(
                        (value) => !selected.has(value),
                      );
                      mutateValues(newValues);
                      setSelected(new Set());
                    }}
                    link={true}
                    useIcon={true}
                    displayName={`${selected.size} selected item${
                      selected.size > 1 ? "s" : ""
                    }`}
                  />
                )}
                <Button
                  variant="ghost"
                  color="red"
                  onClick={() => {
                    if (!selectedRevision && userOpenRevision) {
                      selectFlow(userOpenRevision);
                    }
                    setImportOperation("replace");
                    setAddItems(true);
                  }}
                >
                  Overwrite list
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!selectedRevision && userOpenRevision) {
                      selectFlow(userOpenRevision);
                    }
                    setImportOperation("append");
                    setAddItems(true);
                  }}
                >
                  <span className="mr-1 lh-full">
                    <FaPlusCircle />
                  </span>
                  <span className="lh-full">Add items</span>
                </Button>
              </Flex>
            </Flex>

            <table className="table gbtable table-hover appbox table-valign-top">
              <thead>
                <tr>
                  <th style={{ width: "48px" }}>
                    <Checkbox
                      value={
                        values.length > 0 && selected.size === values.length
                      }
                      setValue={(checked) => {
                        if (checked) {
                          setSelected(new Set(values));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                      size="sm"
                    />
                  </th>
                  <th>
                    <Flex justify="between" align="center">
                      <span>{savedGroup.attributeKey}</span>
                      <div
                        className="cursor-pointer text-color-primary"
                        onClick={() => {
                          setSortNewestFirst(!sortNewestFirst);
                          setCurrentPage(1);
                        }}
                      >
                        <PiArrowsDownUp className="mr-1 lh-full align-middle" />
                        <span className="lh-full align-middle">
                          {sortNewestFirst
                            ? "Most Recently Added"
                            : "Least Recently Added"}
                        </span>
                      </div>
                    </Flex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {valuesPage.map((value) => {
                  return (
                    <tr
                      key={value}
                      onClick={() => {
                        if (selected.has(value)) {
                          const newSelected = new Set(selected);
                          newSelected.delete(value);
                          setSelected(newSelected);
                        } else {
                          setSelected(new Set(selected).add(value));
                        }
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          value={selected.has(value)}
                          setValue={(checked) => {
                            if (checked) {
                              setSelected(new Set(selected).add(value));
                            } else {
                              const newSelected = new Set(selected);
                              newSelected.delete(value);
                              setSelected(newSelected);
                            }
                          }}
                          size="sm"
                        />
                      </td>
                      <td>{value}</td>
                    </tr>
                  );
                })}
                {!displayedValues.length && (
                  <tr>
                    <td colSpan={2}>
                      This group doesn&apos;t have any items yet
                    </td>
                  </tr>
                )}
                {displayedValues.length && !filteredValues.length ? (
                  <tr>
                    <td colSpan={2}>No matching items</td>
                  </tr>
                ) : (
                  <></>
                )}
              </tbody>
            </table>
            {Math.ceil(filteredValues.length / NUM_PER_PAGE) > 1 && (
              <Pagination
                numItemsTotal={displayedValues.length}
                currentPage={currentPage}
                perPage={NUM_PER_PAGE}
                onPageChange={(d) => {
                  setCurrentPage(d);
                }}
              />
            )}
            {!displayedValues.length &&
              !displayedSavedGroup?.useEmptyListGroup && (
                <Callout status="info">
                  This saved group has legacy behavior when empty and will be
                  completely ignored when used for targeting.{" "}
                  <DocLink docSection="idLists">Learn More</DocLink>
                </Callout>
              )}
          </>
        )}
      </div>
    </>
  );
}
