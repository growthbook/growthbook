import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ago } from "shared/dates";
import { FaPlusCircle } from "react-icons/fa";
import { PiArrowsDownUp, PiWarningFill } from "react-icons/pi";
import {
  experimentsReferencingSavedGroups,
  featuresReferencingSavedGroups,
  isIdListSupportedAttribute,
} from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { isEmpty } from "lodash";
import { Box, Card, Container, Flex, Heading, Text } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { getSavedGroupMessage } from "@/pages/saved-groups";
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
import { DocLink } from "@/components/DocLink";
import Callout from "@/ui/Callout";
import { useExperiments } from "@/hooks/useExperiments";
import Button from "@/ui/Button";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupReferences from "@/components/SavedGroups/SavedGroupReferences";
import SavedGroupReferencesList from "@/components/SavedGroups/SavedGroupReferencesList";

const NUM_PER_PAGE = 10;

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`,
  );
  const savedGroup = data?.savedGroup;
  const { features } = useFeaturesList(false);
  const { experiments } = useExperiments();
  const environments = useEnvironments();
  const [sortNewestFirst, setSortNewestFirst] = useState<boolean>(true);
  const [addItems, setAddItems] = useState<boolean>(false);
  const [itemsToAdd, setItemsToAdd] = useState<string[]>([]);
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const [showReferencesModal, setShowReferencesModal] =
    useState<boolean>(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);
  const { savedGroupSizeLimit } = useOrgSettings();

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
  const { projects, savedGroups: allSavedGroups } = useDefinitions();

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

  const savedGroupsReferencingTarget = useMemo(() => {
    if (!savedGroup || !allSavedGroups) return [];
    return allSavedGroups.filter((sg) => {
      if (sg.id === savedGroup.id) return false;
      if (!sg.condition) return false;
      return sg.condition.includes(savedGroup.id);
    });
  }, [savedGroup, allSavedGroups]);

  const referencingFeatures = useMemo(() => {
    if (!savedGroup || !savedGroupsReferencingTarget.length)
      return [] as FeatureInterface[];
    const referenceMap = featuresReferencingSavedGroups({
      savedGroups: savedGroupsReferencingTarget,
      features,
      environments,
    });
    const allFeatures = new Map<string, FeatureInterface>();
    savedGroupsReferencingTarget.forEach((sg) => {
      (referenceMap[sg.id] || []).forEach((feature) => {
        allFeatures.set(feature.id, feature);
      });
    });
    return Array.from(allFeatures.values());
  }, [savedGroup, savedGroupsReferencingTarget, features, environments]);

  const referencingExperiments = useMemo(() => {
    if (!savedGroup || !savedGroupsReferencingTarget.length)
      return [] as ExperimentInterfaceStringDates[];
    const referenceMap = experimentsReferencingSavedGroups({
      savedGroups: savedGroupsReferencingTarget,
      experiments,
    });
    const allExperiments = new Map<
      string,
      ExperimentInterface | ExperimentInterfaceStringDates
    >();
    savedGroupsReferencingTarget.forEach((sg) => {
      (referenceMap[sg.id] || []).forEach((experiment) => {
        allExperiments.set(experiment.id, experiment);
      });
    });
    return Array.from(
      allExperiments.values(),
    ) as ExperimentInterfaceStringDates[];
  }, [savedGroup, savedGroupsReferencingTarget, experiments]);

  const referencingSavedGroups = useMemo(() => {
    if (!savedGroup || !savedGroupsReferencingTarget.length)
      return [] as SavedGroupInterface[];
    // Exclude the target saved group itself
    return savedGroupsReferencingTarget.filter((sg) => sg.id !== savedGroup.id);
  }, [savedGroup, savedGroupsReferencingTarget]);

  const totalReferences =
    referencingFeatures.length +
    referencingExperiments.length +
    referencingSavedGroups.length;

  const getConfirmationContent = useMemo(() => {
    return getSavedGroupMessage(
      referencingFeatures,
      referencingExperiments,
      referencingSavedGroups,
    );
  }, [referencingFeatures, referencingExperiments, referencingSavedGroups]);

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
          <Flex align="center" gap="5">
            <DeleteButton
              className="font-weight-bold"
              text="Delete"
              title="Delete this Saved Group"
              getConfirmationContent={getConfirmationContent}
              canDelete={
                isEmpty(referencingFeatures) &&
                isEmpty(referencingExperiments) &&
                isEmpty(referencingSavedGroups)
              }
              onClick={async () => {
                await apiCall(`/saved-groups/${savedGroup.id}`, {
                  method: "DELETE",
                });
                router.push("/saved-groups");
              }}
              link={true}
              useIcon={false}
              displayName={"Saved Group '" + savedGroup.groupName + "'"}
            />
            <Button
              onClick={() => {
                setSavedGroupForm(savedGroup);
              }}
            >
              Edit
            </Button>
          </Flex>
        </Flex>
        <Flex align="center" gap="4" mb="4" wrap="wrap">
          {savedGroup.type === "list" && (
            <Text>
              Attribute Key: <strong>{savedGroup.attributeKey}</strong>
            </Text>
          )}
          {(projects.length > 0 || (savedGroup.projects?.length ?? 0) > 0) && (
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
        {savedGroup.description && (
          <Text as="p" mb="3">
            {savedGroup.description}
          </Text>
        )}
        {savedGroup.type === "list" && !isIdListSupportedAttribute(attr) && (
          <Callout status="error" icon={<PiWarningFill />} mt="3">
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
            <Flex gap="4" mb="3" align="center" justify="between">
              <Heading size="4" mb="0">
                Condition
              </Heading>
              <Box flexShrink="0">
                <SavedGroupReferences
                  totalReferences={totalReferences}
                  onShowReferences={() => setShowReferencesModal(true)}
                />
              </Box>
            </Flex>
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
            <div className="row m-0 mb-4 align-items-center justify-content-between">
              <div className="">
                <Field
                  placeholder="Search..."
                  type="search"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                  }}
                />
              </div>
              <Flex>
                <SavedGroupReferences
                  totalReferences={totalReferences}
                  onShowReferences={() => setShowReferencesModal(true)}
                />
                <Container mr="4">
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
                </Container>
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
            </div>
            <h4>ID List Items</h4>
            <div className="row m-0 mb-3 align-items-center justify-content-between">
              <div className="row m-0 align-items-center">
                {selected.size > 0 && (
                  <>
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
                  </>
                )}
              </div>
              <div className="d-flex align-items-center">
                {values.length > 0 && (
                  <div className="mr-3">
                    {(start + 1).toLocaleString()}-
                    {(start + valuesPage.length).toLocaleString()} of{" "}
                    {(values.length || 0).toLocaleString()}
                  </div>
                )}
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
              </div>
            </div>

            <table className="table gbtable table-hover appbox">
              <thead>
                <tr>
                  <th style={{ width: "48px" }}>
                    <input
                      type="checkbox"
                      checked={
                        values.length > 0 && selected.size === values.length
                      }
                      readOnly={true}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelected(new Set(values));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                    />
                  </th>
                  <th>{savedGroup.attributeKey}</th>
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
                      <td>
                        <input
                          type="checkbox"
                          readOnly={true}
                          checked={selected.has(value)}
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
