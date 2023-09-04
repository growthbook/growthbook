import React, { Fragment, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { MdOutlineViewStream } from "react-icons/md";
import { HiOutlineViewList } from "react-icons/hi";
import {
  ExperimentSearchColumns,
  ExperimentSearchFilters,
  SavedSearchInterface,
} from "back-end/types/experiment";
import { FaAngleLeft, FaChevronRight, FaPencilAlt } from "react-icons/fa";
import Link from "next/link";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import ExperimentsGetStarted from "@/components/HomePage/ExperimentsGetStarted";
import NewFeatureExperiments from "@/components/Experiment/NewFeatureExperiments";
import { useExperiments } from "@/hooks/useExperiments";
import useApi from "@/hooks/useApi";
import ExperimentSearchConfig from "@/components/Experiment/ExperimentSearchConfig";
import ExperimentCustomSearchResults from "@/components/Experiment/ExperimentCustomSearchResults";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";

const NUM_PER_PAGE = 20;

const CustomExperimentsPage = (): React.ReactElement => {
  const {
    ready,
    project,
    getMetricById,
    getProjectById,
    getDatasourceById,
  } = useDefinitions();

  const {
    experiments: allExperiments,
    error,
    mutateExperiments,
    loading,
  } = useExperiments(project);

  const { getUserDisplay, userId } = useUser();
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsView, setResultsView] = useState("box");
  const [showFilter, setShowFilter] = useState(false);
  const [saveSearchModal, setSaveSearchModal] = useState(false);
  const { apiCall } = useAuth();
  const router = useRouter();

  const { ser } = router.query;

  const { data, error: savedSearchError, mutate } = useApi<{
    search: SavedSearchInterface;
  }>(`/experiments/saved-search/${ser}`);

  const existingSavedSearch = data?.search;

  const experiments = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.metrics
          .map((m) => getMetricById(m)?.name)
          .filter(Boolean),
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: exp.archived
          ? "archived"
          : exp.status === "draft"
          ? "drafts"
          : exp.status,
        startDate:
          (exp.status === "running" || exp.status === "stopped"
            ? exp.phases?.[0]?.dateStarted
            : exp.dateCreated) ?? "",
        endDate:
          (exp.status === "stopped"
            ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
            : "") ?? "",
        date:
          (exp.status === "running"
            ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
            : exp.status === "stopped"
            ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
            : exp.dateCreated) ?? "",
      };
    },
    [getMetricById, getProjectById]
  );

  const showFormValues: Record<
    string,
    {
      initialValue: boolean;
      name: string;
      show: boolean;
      sortable: boolean;
    }
  > = {
    name: { initialValue: true, name: "Name", show: false, sortable: true },
    hypothesis: {
      initialValue: true,
      name: "Hypothesis",
      show: true,
      sortable: true,
    },
    description: {
      initialValue: true,
      name: "Description",
      show: true,
      sortable: true,
    },
    trackingKey: {
      initialValue: true,
      name: "Experiment key",
      show: true,
      sortable: true,
    },
    tags: {
      initialValue: true,
      name: "Tags",
      show: true,
      sortable: true,
    },
    projects: {
      initialValue: true,
      name: "Project",
      show: true,
      sortable: true,
    },
    status: {
      initialValue: true,
      name: "Experiment status",
      show: true,
      sortable: true,
    },
    ownerName: {
      initialValue: true,
      name: "Owner",
      show: true,
      sortable: true,
    },
    created: {
      initialValue: true,
      name: "Created",
      show: true,
      sortable: true,
    },
    startDate: {
      initialValue: true,
      name: "Start date",
      show: true,
      sortable: true,
    },
    endDate: {
      initialValue: true,
      name: "End date",
      show: true,
      sortable: true,
    },
    dataSources: {
      initialValue: true,
      name: "Data source",
      show: true,
      sortable: true,
    },
    metrics: {
      initialValue: true,
      name: "Metrics",
      show: true,
      sortable: false,
    },
    graphs: { initialValue: true, name: "Graphs", show: true, sortable: false },
    results: {
      initialValue: true,
      name: "Experiment results",
      show: true,
      sortable: true,
    },
    analysis: {
      initialValue: true,
      name: "Analysis",
      show: true,
      sortable: true,
    },
    variations: {
      initialValue: true,
      name: "Variations",
      show: true,
      sortable: false,
    },
  };
  const showForm = useForm<ExperimentSearchColumns>({
    defaultValues: Object.fromEntries(
      Object.entries(showFormValues).map(([key, value]) => {
        const initVal = existingSavedSearch?.show?.[key] ?? value.initialValue;
        return [key, initVal];
      })
    ),
  });
  const filterForm = useForm<ExperimentSearchFilters>({
    defaultValues: {
      results: existingSavedSearch?.filters?.results ?? [],
      status: existingSavedSearch?.filters?.status ?? [],
      expType: existingSavedSearch?.filters?.expType ?? [],
      tags: existingSavedSearch?.filters?.tags ?? [],
      projects: existingSavedSearch?.filters?.projects ?? [],
      dataSources: existingSavedSearch?.filters?.dataSources ?? [],
      metrics: existingSavedSearch?.filters?.metrics ?? [],
      ownerName: existingSavedSearch?.filters?.ownerName ?? "",
      startDate: existingSavedSearch?.filters?.startDate ?? null,
      endDate: existingSavedSearch?.filters?.endDate ?? null,
    },
  });
  const savedSearchForm = useForm({
    defaultValues: {
      id: "",
      name: "",
      description: "",
      public: true,
      filters: {},
      show: {},
      sort: {},
      display: resultsView,
    },
  });
  //console.log("showForm", showForm);
  const {
    items,
    searchInputProps,
    setSearchValue,
    SortableTH,
    sort,
    setSort,
  } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: existingSavedSearch?.sort?.field ?? "startDate",
    defaultSortDir: -1,
    searchFields: [
      "name^3",
      "trackingKey^3",
      "id^3",
      "hypothesis^2",
      "description",
      "tags",
      "status",
      "ownerName",
      "metricNames",
      "results",
      "analysis",
    ],
  });

  const filterValues = filterForm.getValues();
  const filtered = useMemo(() => {
    let filteredItems = items;
    const {
      results,
      status,
      //expType,
      ownerName,
      //startDate,
      //endDate,
      dataSources,
      metrics,
      tags,
      projects,
    } = filterValues;

    if (results.length) {
      filteredItems = filteredItems.filter((item) => {
        return results.includes(item?.results ?? "");
      });
    }
    if (status.length) {
      filteredItems = filteredItems.filter((item) => {
        return status.includes(item?.status ?? "");
      });
    }
    if (ownerName !== "") {
      filteredItems = filteredItems.filter((item) => {
        return item.ownerName?.toLowerCase().includes(ownerName.toLowerCase());
      });
    }
    if (tags.length) {
      filteredItems = filteredItems.filter((item) => {
        return tags.some((tag) => item.tags?.includes(tag));
      });
    }
    if (dataSources.length) {
      filteredItems = filteredItems.filter((item) => {
        return dataSources.some((ds) => item.datasource?.includes(ds));
      });
    }
    if (metrics.length) {
      filteredItems = filteredItems.filter((item) => {
        return metrics.some((m) => item.metrics?.includes(m));
      });
    }
    if (projects.length) {
      filteredItems = filteredItems.filter((item) => {
        return results.includes(item?.project ?? "");
      });
    }
    return filteredItems;
    //    return items.filter((item) => item.tab === tab);
  }, [items, filterValues]);

  useEffect(() => {
    if (existingSavedSearch) {
      Object.entries(existingSavedSearch).forEach(([key, value]) => {
        // @ts-expect-error TS(7053) Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Record<string, { initialValue: boolean; name: string; show: boolean; sortable: boolean; }>'.
        savedSearchForm.setValue(key, value);
      });
      Object.entries(existingSavedSearch.filters).forEach(([key, value]) => {
        // @ts-expect-error TS(7053) Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Record<string, { initialValue: boolean; name: string; show: boolean; sortable: boolean; }>'.
        filterForm.setValue(key, value);
      });
      Object.entries(existingSavedSearch.show).forEach(([key, value]) => {
        // @ts-expect-error TS(7053) Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Record<string, { initialValue: boolean; name: string; show: boolean; sortable: boolean; }>'.
        showForm.setValue(key, value);
      });
      if (existingSavedSearch?.filters?.search) {
        setSearchValue(existingSavedSearch.filters.search);
      }
      if (existingSavedSearch?.display) {
        setResultsView(existingSavedSearch.display);
      }
      if (existingSavedSearch?.sort) {
        setSort(existingSavedSearch.sort);
      }
      if (!existingSavedSearch?.id) {
        setShowFilter(true);
      }
    }
  }, [
    existingSavedSearch,
    filterForm,
    savedSearchForm,
    setSearchValue,
    setSort,
    showForm,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length, filtered.length]);

  useEffect(() => {
    savedSearchForm.setValue("sort", sort);
  }, [sort, savedSearchForm]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (savedSearchError) {
    return (
      <div className="alert alert-danger">
        An error occurred: {savedSearchError.message}
      </div>
    );
  }

  if (loading || !ready || !data) {
    return <LoadingOverlay />;
  }

  const hasExperiments =
    experiments.filter((m) => !m.id.match(/^exp_sample/)).length > 0;

  if (!hasExperiments) {
    return (
      <div className="contents container pagecontents getstarted">
        <h1>Experiment Analysis</h1>
        <p>
          GrowthBook can pull experiment results directly from your data source
          and analyze it with our statistics engine. Start by connecting to your
          data source and defining metrics.
        </p>
        <NewFeatureExperiments />
        <ExperimentsGetStarted
          experiments={experiments}
          mutate={mutateExperiments}
        />
      </div>
    );
  }

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const filterDescriptionElements: JSX.Element[] = [];
  if (searchInputProps.value) {
    filterDescriptionElements.push(
      <>
        <strong className="text-muted">search term:</strong>{" "}
        <i className="text-purple font-weight-semibold">
          {searchInputProps.value}
        </i>
      </>
    );
  }
  Object.keys(filterValues).forEach((key) => {
    if (key === "search") return; // already handled above
    const keyDisplayName = showFormValues?.[key]?.name ?? key;
    if (Array.isArray(filterValues[key])) {
      if (filterValues[key].length > 0) {
        const elements = filterValues[key].map((v, i) => {
          let displayValue = v;
          if (key === "dataSources") {
            displayValue = getDatasourceById(v)?.name ?? v;
          }
          if (key === "metrics") {
            displayValue = getMetricById(v)?.name ?? v;
          }
          return (
            <Fragment key={key + v}>
              <i className="text-purple font-weight-semibold">{displayValue}</i>
              {i === filterValues[key].length - 1
                ? ""
                : i === filterValues[key].length - 2
                ? " or "
                : ", "}
            </Fragment>
          );
        });
        filterDescriptionElements.push(
          <>
            <strong className="text-muted">{keyDisplayName}</strong>:{" "}
            {elements.map((v, i) => (
              <Fragment key={"x" + i}>{v}</Fragment>
            ))}{" "}
          </>
        );
      }
    } else if (filterValues[key]) {
      if (filterValues[key] !== "") {
        filterDescriptionElements.push(
          <>
            <strong className="text-muted">{keyDisplayName}</strong>:{" "}
            <i className="text-purple font-weight-semibold">
              {filterValues[key]}
            </i>{" "}
          </>
        );
      }
    }
  });
  //console.log("sort", sort);

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-2">
          <Link href="/experiments/custom">
            <a>
              <FaAngleLeft /> All Experiment Searches
            </a>
          </Link>
        </div>
        <div className="mb-5">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h3 className="d-inline-block">
                {existingSavedSearch?.name || "Custom search"}
              </h3>
              {existingSavedSearch?.id && existingSavedSearch.owner === userId && (
                <a
                  href="#"
                  className="pl-2 d-inline-block"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowFilter(true);
                    setSaveSearchModal(true);
                  }}
                >
                  <FaPencilAlt />
                </a>
              )}
              {existingSavedSearch?.description && (
                <p className="mb-0">{existingSavedSearch?.description}</p>
              )}
            </div>
            <div style={{ flex: 1 }} />
            {existingSavedSearch?.id && existingSavedSearch.owner === userId && (
              <div className="col-auto">
                <MoreMenu>
                  <DeleteButton
                    className="btn dropdown-item py-2"
                    text="Delete"
                    title="Delete this saved search?"
                    onClick={async () => {
                      await apiCall(
                        `/experiments/saved-search/${existingSavedSearch.id}`,
                        {
                          method: "DELETE",
                        }
                      );
                      mutate();
                      router.push("/experiments/custom");
                    }}
                    useIcon={true}
                    displayName={
                      "Saved search '" + existingSavedSearch?.name + "'"
                    }
                  />
                </MoreMenu>
              </div>
            )}
          </div>

          <div className="mb-3 appbox p-3">
            {showFilter ? (
              <>
                <div className="">
                  <div
                    className="cursor-pointer float-right"
                    onClick={() => setShowFilter(!showFilter)}
                  >
                    <FaChevronRight
                      style={{
                        transform: `rotate(${showFilter ? "90deg" : "0deg"})`,
                      }}
                    />
                  </div>
                  <h4>Filter</h4>
                </div>
                <ExperimentSearchConfig
                  searchInputProps={searchInputProps}
                  filterForm={filterForm}
                  showForm={showForm}
                  sort={sort}
                  setSort={setSort}
                  showFormValues={showFormValues}
                  existingSavedSearch={existingSavedSearch}
                  savedSearchForm={savedSearchForm}
                  setShowFilter={setShowFilter}
                  onUpdate={mutate}
                  saveSearchModal={saveSearchModal}
                  setSaveSearchModal={setSaveSearchModal}
                />
              </>
            ) : (
              <div onClick={() => setShowFilter(!showFilter)}>
                <div className="cursor-pointer float-right">
                  <FaChevronRight
                    style={{
                      transform: `rotate(${showFilter ? "90deg" : "0deg"})`,
                    }}
                  />
                </div>
                {filterDescriptionElements.length > 0 ? (
                  <>
                    Showing experiments where{" "}
                    {filterDescriptionElements.map((v, i) => (
                      <>
                        {v}
                        {i !== filterDescriptionElements.length - 1
                          ? " AND "
                          : ""}
                      </>
                    ))}
                  </>
                ) : (
                  "Showing all experiments"
                )}
              </div>
            )}
          </div>

          <div className="results-area">
            <div className="row justify-content-between mb-2">
              <div className="col">
                <h3 className="mb-0">
                  {filtered.length} Experiment
                  {filtered.length === 1 ? "" : "s"}
                </h3>
              </div>
              <div className="col-auto">
                <div className="toggle-viewer">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setResultsView("table");
                      savedSearchForm.setValue("display", "table");
                    }}
                    className={`${resultsView === "table" ? "selected" : ""}`}
                  >
                    <HiOutlineViewList />
                  </a>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setResultsView("box");
                      savedSearchForm.setValue("display", "box");
                    }}
                    className={`${resultsView === "box" ? "selected" : ""}`}
                  >
                    <MdOutlineViewStream />
                  </a>
                </div>
              </div>
            </div>
          </div>

          <ExperimentCustomSearchResults
            filtered={filtered}
            start={start}
            end={end}
            showForm={showForm}
            SortableTH={SortableTH}
            resultsView={resultsView}
          />

          {filtered.length > NUM_PER_PAGE && (
            <Pagination
              numItemsTotal={filtered.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={setCurrentPage}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default CustomExperimentsPage;
