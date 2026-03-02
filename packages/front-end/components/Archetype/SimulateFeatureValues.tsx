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
import {
  useEnvironments,
  useFeatureSearch,
  useFeaturesList,
} from "@/services/features";
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
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";

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

  const { features: allFeatures, loading } = useFeaturesList({
    useCurrentProject: true,
  });

  const tagsFilter = useTagsFilter("features");
  const filterResults = useCallback(
    (items: typeof allFeatures) => {
      items = items.filter((f) => !f.archived);
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [tagsFilter.tags],
  );
  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
  const canCreate = permissionsUtil.canCreateArchetype({ projects: [project] });
  const { hasCommercialFeature } = useUser();
  const hasSimulateFeature = hasCommercialFeature("simulate");

  const { searchInputProps, items, SortableTH } = useFeatureSearch({
    allFeatures,
    filterResults,
    environments,
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
    return <div>No environments added</div>;
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
  const numColumns = showEnvDropdown ? 4 : environments.length + 3;
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
      <div className="mb-3">
        <div className="row mb-3">
          <div className="col">
            <div className="border border-primary appbox p-3">
              {attributeText} {attributeNodes}{" "}
              <a
                href="#"
                className="ml-2"
                onClick={(e) => {
                  e.preventDefault();
                  setEditAttributesModalOpen(true);
                }}
              >
                ({attributes && Object.keys(attributes).length ? "edit" : "set"}
                )
              </a>
            </div>
          </div>
        </div>

        <div
          style={{
            opacity: featureResults.length > 0 ? 1 : 0.75,
          }}
        >
          <div className="mb-2 d-flex">
            <div className="mr-2">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
            <div className="align-self-center">
              <TagsFilter filter={tagsFilter} items={items} />
            </div>
            <div className="ml-auto">
              {showEnvDropdown && (
                <div className="d-flex flex-nowrap">
                  <div className="mr-1 align-self-center small">
                    Environment:
                  </div>
                  <SelectField
                    value={!selectedEnvironment ? "all" : selectedEnvironment}
                    options={environmentOptions}
                    onChange={(e) => {
                      setSelectedEnvironment(e);
                      refreshResults();
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <table className="table gbtable table-hover appbox">
            <thead
              className="sticky-top bg-white shadow-sm"
              style={{ top: "56px", zIndex: 900 }}
            >
              <tr>
                <th>Feature Name</th>
                <SortableTH field="tags">Tags</SortableTH>
                <th style={{ borderRight: "1px solid rgba(155,155,155, 0.2)" }}>
                  Prerequisites
                </th>
                {selectedEnvironment !== "all" ? (
                  <th>{selectedEnvironment}</th>
                ) : (
                  <>
                    {environments.slice(0, maxEnvironments).map((en) => (
                      <th key={en.id + "head"} className="">
                        {en.id}
                      </th>
                    ))}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {featureItems.map((feature) => {
                // get a list of all the prerequisites for this feature - both top level and rule prerequisites.
                const prerequisites =
                  feature.prerequisites?.map((p) => {
                    return p.id;
                  }) ?? [];
                if (feature.environmentSettings) {
                  Object.values(feature.environmentSettings).forEach(
                    (envSetting) => {
                      if (envSetting.rules) {
                        envSetting.rules.forEach((rule) => {
                          if (rule.prerequisites) {
                            rule.prerequisites.forEach((p) => {
                              if (!prerequisites.includes(p.id)) {
                                prerequisites.push(p.id);
                              }
                            });
                          }
                        });
                      }
                    },
                  );
                }
                return (
                  <Fragment key={feature.id + "results"}>
                    <tr className={feature.archived ? "text-muted" : ""}>
                      <td>
                        <Link
                          href={`/features/${feature.id}`}
                          className={feature.archived ? "text-muted" : ""}
                        >
                          {feature.id}
                        </Link>
                      </td>
                      <td>
                        <SortedTags tags={feature?.tags || []} />
                      </td>
                      <td
                        className="small"
                        style={{
                          borderRight: "1px solid rgba(155,155,155, 0.2)",
                        }}
                      >
                        {prerequisites &&
                          prerequisites.map((p, i) => {
                            return (
                              <Fragment key={`loop-${i}`}>
                                <Link href={`/features/${p}`}>{p}</Link>
                                {i === (prerequisites?.length || 1) - 1
                                  ? ""
                                  : ", "}
                              </Fragment>
                            );
                          })}
                      </td>
                      {selectedEnvironment !== "all" ? (
                        (() => {
                          const res = featureResultsMap.get(
                            feature.id + selectedEnvironment,
                          );
                          if (!res) {
                            return <td>-</td>;
                          }
                          return (
                            <td>
                              <div>
                                {ArchetypeValueDisplay({
                                  result: res,
                                  feature,
                                })}
                              </div>
                            </td>
                          ); // Replace this with what you want to render
                        })()
                      ) : (
                        <>
                          {environments.slice(0, maxEnvironments).map((en) => {
                            const res = featureResultsMap.get(
                              feature.id + en.id,
                            );
                            if (!res) {
                              return (
                                <td key={"unknown-" + en.id + feature.id}>-</td>
                              );
                            }
                            return (
                              <td
                                key={feature.id + en.id + "row"}
                                className="position-relative  cursor-pointer"
                              >
                                <div>
                                  {ArchetypeValueDisplay({
                                    result: res,
                                    feature,
                                  })}
                                </div>
                              </td>
                            );
                          })}
                        </>
                      )}
                    </tr>
                  </Fragment>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={numColumns}>No matching features</td>
                </tr>
              )}
            </tbody>
          </table>
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
        </div>
      </div>
      <div className="alert-info mt-5 mb-5 p-3 cursor-pointer align-items-center">
        <div
          className="d-flex"
          onClick={(e) => {
            e.preventDefault();
            setOpenWarning(!openWarning);
          }}
        >
          <div className="p-2 pr-3">
            <FiAlertTriangle />
          </div>
          <div>
            These results use the JS SDK, which supports the V2 hashing
            algorithm. If you use one of the older or unsupported SDKs, you may
            want to change the hashing algorithm of the experiment to v1 to
            ensure accurate results. Click for more info.
          </div>
          <div className="p-2">
            <FaChevronRight
              style={{
                transform: `rotate(${openWarning ? "90deg" : "0deg"})`,
              }}
            />
          </div>
        </div>
        {openWarning && (
          <div className="p-3">
            The following SDK versions support V2 hashing:
            <MinSDKVersionsList capability="bucketingV2" />
          </div>
        )}
      </div>
    </>
  );

  if (!hasSimulateFeature) {
    return (
      <div className="mb-3">
        <PremiumEmptyState
          title="Simulate feature/experiment states for Users"
          description=" For any set of attributes or archetype, simulate what feature
              values they have or would receive. Simulation is a premium
              feature."
          commercialFeature="simulate"
          learnMoreLink="https://docs.growthbook.io/features/rules#simulation"
        />
      </div>
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
      <div className="">
        <div className="row mb-3">
          <div className="col">
            <h1>Simulate Features</h1>
          </div>
          <div className="col-auto">
            <Button
              onClick={() => {
                setEditAttributesModalOpen(true);
              }}
            >
              {attributes && Object.keys(attributes).length ? "Edit" : "Set"}{" "}
              Attributes
            </Button>
          </div>
        </div>

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
      </div>
    </>
  );
};
