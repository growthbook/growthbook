import React, {
  FC,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArchetypeAttributeValues,
  ArchetypeInterface,
} from "shared/types/archetype";
import { FeatureTestResult } from "shared/types/feature";
import Link from "next/link";
import { FaChevronRight, FaInfoCircle } from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { Box, Flex } from "@radix-ui/themes";
import { useEnvironments } from "@/services/features";
import { useSearch } from "@/services/search";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useAuth } from "@/services/auth";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import SortedTags from "@/components/Tags/SortedTags";
import { ArchetypeValueDisplay } from "@/components/Features/ValueDisplay";
import Pagination from "@/components/Pagination";
import LoadingOverlay from "@/components/LoadingOverlay";
import SimulateFeatureModal from "@/components/Archetype/SimulateFeatureModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { TruncateMiddleWithTooltip } from "@/ui/TruncateMiddleWithTooltip";

/** Aligns with features list feature-key column */
const SIMULATE_FEATURE_NAME_COLUMN_MAX = 200;

export const SimulateFeatureValues: FC<{
  archetypes: ArchetypeInterface[];
}> = ({ archetypes }) => {
  const NUM_PER_PAGE = 20;
  const maxEnvironments = 3;

  const [currentPage, setCurrentPage] = useState(1);
  const [editAttributesModalOpen, setEditAttributesModalOpen] = useState(false);
  const [attributes, setAttributes] = useState<ArchetypeAttributeValues>({});
  const [archetype, setArchetype] = useState("");
  const [openWarning, setOpenWarning] = useState(false);
  const [featureResults, setFeatureResults] = useState<
    {
      [key: string]: FeatureTestResult;
    }[]
  >([]);
  const [featureResultsMap, setFeatureResultsMap] = useState<
    Map<string, FeatureTestResult>
  >(new Map());
  const [evaluatedAttributes, setEvaluatedAttributes] =
    useState<ArchetypeAttributeValues>({});
  const [evaluatedFeatures, setEvaluatedFeatures] = useState<string[]>([]);
  const environments = useEnvironments();
  const showAllEnv = environments.length <= maxEnvironments;
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>(
    showAllEnv ? "all" : environments[0].id,
  );
  const [evaluatedEnvironment, setEvaluatedEnvironment] =
    useState(selectedEnvironment);
  const { apiCall } = useAuth();

  const { project } = useDefinitions();
  const { features: allFeatures, loading } = useFeatureMetaInfo({ project });

  const tagsFilter = useTagsFilter("features");
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateArchetype({ projects: [project] });
  const { hasCommercialFeature, getOwnerDisplay } = useUser();
  const hasSimulateFeature = hasCommercialFeature("simulate");

  const { searchInputProps, items, SortableTableColumnHeader } = useSearch({
    items: allFeatures.filter((f) => !f.archived),
    searchFields: ["id^3", "description"],
    localStorageKey: "simulate-features",
    defaultSortField: "id",
    filterResults: (items) => filterByTags(items, tagsFilter.tags),
    searchTermFilters: {
      is: (item) => [item.valueType ?? ""],
      tag: (item) => item.tags,
      project: (item) => [item.project ?? ""],
      owner: (item) => [item.owner, getOwnerDisplay(item.owner)],
    },
  });

  const featureItems = useMemo(() => {
    const start = (currentPage - 1) * NUM_PER_PAGE;
    const end = start + NUM_PER_PAGE;
    return items.slice(start, end);
  }, [items, currentPage]);

  // refresh the results of the assignment of features for the attributes set
  const refreshResults = useCallback(() => {
    // only refresh if the attributes, features, or environment have changed
    if (
      evaluatedEnvironment !== selectedEnvironment ||
      JSON.stringify(attributes) !== JSON.stringify(evaluatedAttributes) ||
      JSON.stringify(evaluatedFeatures) !==
        JSON.stringify(featureItems.map((f) => f.id))
    ) {
      apiCall<{
        results: { [key: string]: FeatureTestResult }[];
      }>(`/features/eval`, {
        method: "POST",
        body: JSON.stringify({
          attributes: attributes,
          featureIds: featureItems.map((f) => f.id),
          environment: selectedEnvironment === "all" ? "" : selectedEnvironment,
        }),
      })
        .then((data) => {
          if (data && data.results) {
            setFeatureResults(data.results);
            const featureResultsMap = new Map<string, FeatureTestResult>();
            data.results.forEach((r) => {
              Object.keys(r).forEach((featureId) => {
                featureResultsMap.set(
                  featureId + r[featureId].env,
                  r[featureId],
                );
              });
            });
            setFeatureResultsMap(featureResultsMap);
            // keep track of what we evaluated so we don't have to do it again.
            setEvaluatedAttributes(attributes);
            setEvaluatedFeatures(featureItems.map((f) => f.id));
            setEvaluatedEnvironment(selectedEnvironment);
          }
        })
        .catch((e) => console.error(e));
    }
  }, [
    featureItems,
    attributes,
    evaluatedAttributes,
    evaluatedFeatures,
    apiCall,
    selectedEnvironment,
    evaluatedEnvironment,
  ]);

  useEffect(() => {
    refreshResults();
  }, [featureItems, currentPage, refreshResults, selectedEnvironment]);

  const archetypeMap = new Map<string, ArchetypeInterface>();
  if (archetypes) {
    archetypes.forEach((a) => {
      archetypeMap.set(a.id, a);
    });
  }

  if (loading) {
    return <LoadingOverlay />;
  }
  if (!environments || environments.length === 0) {
    return <Box>No environments added</Box>;
  }
  let attributeText = (
    <>Select Archetype or edit user attributes to see feature results.</>
  );
  let attributeNodes: ReactNode[] = [];
  if (attributes && Object.keys(attributes).length > 0) {
    attributeText = archetype ? (
      <>
        Showing feature results for archetype{" "}
        <strong>{archetypeMap.get(archetype)?.name ?? "?"}</strong>:
      </>
    ) : (
      <>Showing feature results for users with attributes: </>
    );
    const attrsLength = Object.keys(attributes).length;
    attributeNodes = Object.keys(attributes).map((key, i) => {
      const attrValue = JSON.stringify(attributes[key]);
      return (
        <Fragment key={`attr-${key}-${i}`}>
          <strong>{key}</strong>: <strong>{attrValue}</strong>
          {i === attrsLength - 1 ? "" : i === attrsLength - 2 ? ", and " : ", "}
        </Fragment>
      );
    });
  }

  const showEnvDropdown = true;
  const numColumns = showEnvDropdown ? 3 : environments.length + 2;
  const environmentOptions = [
    ...environments.map((e) => {
      return { label: e.id, value: e.id };
    }),
  ];
  if (showAllEnv) {
    environmentOptions.unshift({ label: "All", value: "all" });
  }

  const featureTableResults = (
    <>
      <Box mb="3">
        <Box mb="3" p="3" className="appbox border border-primary">
          {attributeText} {attributeNodes}{" "}
          <a
            href="#"
            className="ml-2"
            onClick={(e) => {
              e.preventDefault();
              setEditAttributesModalOpen(true);
            }}
          >
            ({attributes && Object.keys(attributes).length ? "edit" : "set"})
          </a>
        </Box>

        <Box
          style={{
            opacity: featureResults.length > 0 ? 1 : 0.75,
          }}
        >
          <Flex align="center" gap="2" wrap="wrap" mb="2">
            <Box style={{ minWidth: "200px", flex: "1 1 200px" }}>
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <TagsFilter filter={tagsFilter} items={items} />
            {showEnvDropdown ? (
              <Flex
                align="center"
                gap="1"
                wrap="nowrap"
                ml="auto"
                style={{ flexShrink: 0 }}
              >
                <Box
                  className="small"
                  style={{ alignSelf: "center", whiteSpace: "nowrap" }}
                >
                  Environment:
                </Box>
                <SelectField
                  value={!selectedEnvironment ? "all" : selectedEnvironment}
                  options={environmentOptions}
                  onChange={(e) => {
                    setSelectedEnvironment(e);
                    refreshResults();
                  }}
                />
              </Flex>
            ) : null}
          </Flex>

          <Table variant="list" stickyHeader roundedCorners className="appbox">
            <TableHeader>
              <TableRow>
                <TableColumnHeader
                  style={{ maxWidth: SIMULATE_FEATURE_NAME_COLUMN_MAX }}
                >
                  Feature Name
                </TableColumnHeader>
                <SortableTableColumnHeader field="tags">
                  Tags
                </SortableTableColumnHeader>
                {selectedEnvironment !== "all" ? (
                  <TableColumnHeader>{selectedEnvironment}</TableColumnHeader>
                ) : (
                  <>
                    {environments.slice(0, maxEnvironments).map((en) => (
                      <TableColumnHeader key={en.id + "head"}>
                        {en.id}
                      </TableColumnHeader>
                    ))}
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureItems.map((feature) => {
                return (
                  <Fragment key={feature.id + "results"}>
                    <TableRow className={feature.archived ? "text-muted" : ""}>
                      <TableCell
                        style={{
                          padding: "var(--space-0)",
                          maxWidth: SIMULATE_FEATURE_NAME_COLUMN_MAX,
                        }}
                      >
                        <Link
                          href={`/features/${feature.id}`}
                          className="featurename"
                          style={{
                            padding: "var(--space-3)",
                            display: "block",
                            color: feature.archived
                              ? "var(--gray-11)"
                              : undefined,
                          }}
                        >
                          <TruncateMiddleWithTooltip
                            text={feature.id}
                            maxChars={23}
                            maxWidth={SIMULATE_FEATURE_NAME_COLUMN_MAX}
                            flipTheme={false}
                          />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <SortedTags
                          tags={feature?.tags || []}
                          maxVisibleTags={1}
                          truncateTagChars={15}
                        />
                      </TableCell>
                      {selectedEnvironment !== "all" ? (
                        (() => {
                          const res = featureResultsMap.get(
                            feature.id + selectedEnvironment,
                          );
                          if (!res) {
                            return <TableCell>-</TableCell>;
                          }
                          return (
                            <TableCell>
                              <div>
                                {ArchetypeValueDisplay({
                                  result: res,
                                  feature,
                                })}
                              </div>
                            </TableCell>
                          );
                        })()
                      ) : (
                        <>
                          {environments.slice(0, maxEnvironments).map((en) => {
                            const res = featureResultsMap.get(
                              feature.id + en.id,
                            );
                            if (!res) {
                              return (
                                <TableCell
                                  key={"unknown-" + en.id + feature.id}
                                >
                                  -
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell
                                key={feature.id + en.id + "row"}
                                className="position-relative cursor-pointer"
                              >
                                <div>
                                  {ArchetypeValueDisplay({
                                    result: res,
                                    feature,
                                  })}
                                </div>
                              </TableCell>
                            );
                          })}
                        </>
                      )}
                    </TableRow>
                  </Fragment>
                );
              })}
              {!items.length && (
                <TableRow>
                  <TableCell colSpan={numColumns}>
                    No matching features
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {Math.ceil(items.length / NUM_PER_PAGE) > 1 && (
            <Pagination
              numItemsTotal={items.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={(d) => {
                setCurrentPage(d);
              }}
            />
          )}
        </Box>
      </Box>
      <Box mt="5" mb="5">
        <Callout status="info" contentsAs="div" icon={null}>
          <Box
            onClick={(e) => {
              e.preventDefault();
              setOpenWarning(!openWarning);
            }}
            style={{ cursor: "pointer" }}
          >
            <Flex align="start" gap="2">
              <Box p="2" style={{ flexShrink: 0 }}>
                <FiAlertTriangle />
              </Box>
              <Box style={{ flex: 1 }}>
                These results use the JS SDK, which supports the V2 hashing
                algorithm. If you use one of the older or unsupported SDKs, you
                may want to change the hashing algorithm of the experiment to v1
                to ensure accurate results. Click for more info.
              </Box>
              <Box p="2" style={{ flexShrink: 0 }}>
                <FaChevronRight
                  style={{
                    transform: `rotate(${openWarning ? "90deg" : "0deg"})`,
                  }}
                />
              </Box>
            </Flex>
          </Box>
          {openWarning && (
            <Box p="3" mt="2">
              The following SDK versions support V2 hashing:
              <MinSDKVersionsList capability="bucketingV2" />
            </Box>
          )}
        </Callout>
      </Box>
    </>
  );

  if (!hasSimulateFeature) {
    return (
      <Box mb="3">
        <PremiumEmptyState
          title="Simulate feature/experiment states for Users"
          description=" For any set of attributes or archetype, simulate what feature
              values they have or would receive. Simulation is a premium
              feature."
          commercialFeature="simulate"
          learnMoreLink="https://docs.growthbook.io/features/rules#simulation"
        />
      </Box>
    );
  }

  return (
    <>
      {editAttributesModalOpen && (
        <SimulateFeatureModal
          archetype={archetype}
          archetypeMap={archetypeMap}
          attributes={attributes}
          close={() => {
            setEditAttributesModalOpen(false);
          }}
          onSubmit={({ archetype, attributes }) => {
            setArchetype(archetype);
            setAttributes(attributes);
            setEditAttributesModalOpen(false);
            refreshResults();
          }}
        />
      )}
      <Box>
        <Flex align="center" justify="between" mb="3" gap="3" wrap="wrap">
          <Heading as="h1" size="2x-large">
            Simulate Features
          </Heading>
          <Button
            onClick={() => {
              setEditAttributesModalOpen(true);
            }}
          >
            {attributes && Object.keys(attributes).length ? "Edit" : "Set"}{" "}
            Attributes
          </Button>
        </Flex>

        {!canCreate ? (
          <PremiumTooltip
            commercialFeature="simulate"
            body={
              <>
                <p className="mb-2 premium">
                  <FaInfoCircle className="mr-1" />
                  This is a premium feature
                </p>
                <p>
                  Simulate features using different user attributes to see which
                  values they would be assigned.
                </p>
              </>
            }
          >
            <div
              className="position-relative"
              style={{ filter: "blur(1.2px)" }}
            >
              {featureTableResults}
              <div
                className=""
                style={{
                  position: "absolute",
                  background: "rgba(255,255,255,0.1)",
                  top: "0",
                  bottom: "0",
                  left: "0",
                  right: "0",
                }}
              ></div>
            </div>
          </PremiumTooltip>
        ) : (
          <>{featureTableResults}</>
        )}
      </Box>
    </>
  );
};
