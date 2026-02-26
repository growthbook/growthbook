import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
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
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";

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
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);
  const { savedGroupSizeLimit } = useOrgSettings();

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
  const filteredValues = values.filter((v) => v.match(filter));
  const sortedValues = sortNewestFirst
    ? filteredValues.reverse()
    : filteredValues;

  const { apiCall } = useAuth();

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = sortedValues.slice(start, end);
  const [importOperation, setImportOperation] = useState<"replace" | "append">(
    "replace",
  );
  const { attributeSchema } = useOrgSettings();
  const { projects } = useDefinitions();

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
          cta="Save"
          ctaEnabled={
            itemsToAdd.length > 0 &&
            (!listAboveSizeLimit || adminBypassSizeLimit)
          }
          submit={async () => {
            let newValues: Set<string>;
            if (importOperation === "append") {
              await apiCall(`/saved-groups/${savedGroup.id}/add-items`, {
                method: "POST",
                body: JSON.stringify({
                  items: itemsToAdd,
                }),
              });
              newValues = new Set([...values, ...itemsToAdd]);
            } else {
              await apiCall(`/saved-groups/${savedGroup.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  values: itemsToAdd,
                }),
              });
              newValues = new Set(itemsToAdd);
            }
            mutateValues([...newValues]);
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
            mutate();
          }}
          current={savedGroupForm}
          type={savedGroup.type}
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
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="3"
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
                  setSavedGroupForm(savedGroup);
                  setDropdownOpen(false);
                }}
              >
                Edit Information
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setShowAuditModal(true);
                  setDropdownOpen(false);
                }}
              >
                Audit History
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
              <strong>{savedGroup.owner ? savedGroup.owner : "None"}</strong>
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
        <hr />
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
                    condition={savedGroup.condition || ""}
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
                    getConfirmationContent={async () => ""}
                    onClick={async () => {
                      await apiCall(
                        `/saved-groups/${savedGroup.id}/remove-items`,
                        {
                          method: "POST",
                          body: JSON.stringify({ items: [...selected] }),
                        },
                      );
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
                    setImportOperation("replace");
                    setAddItems(true);
                  }}
                >
                  Overwrite list
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
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
                {!values.length && (
                  <tr>
                    <td colSpan={2}>
                      This group doesn&apos;t have any items yet
                    </td>
                  </tr>
                )}
                {values.length && !filteredValues.length ? (
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
                numItemsTotal={values.length}
                currentPage={currentPage}
                perPage={NUM_PER_PAGE}
                onPageChange={(d) => {
                  setCurrentPage(d);
                }}
              />
            )}
            {!savedGroup.values?.length && !savedGroup.useEmptyListGroup && (
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
