import React, { Fragment, useEffect, useMemo, useState } from "react";
import { datetime } from "shared/dates";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { BsFlag } from "react-icons/bs";
import { RxDesktop } from "react-icons/rx";
import router from "next/router";
import { MdOutlineViewStream } from "react-icons/md";
import { HiOutlineViewList } from "react-icons/hi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import ExperimentsGetStarted from "@/components/HomePage/ExperimentsGetStarted";
import NewFeatureExperiments from "@/components/Experiment/NewFeatureExperiments";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import { useExperiments } from "@/hooks/useExperiments";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import TagsInput from "@/components/Tags/TagsInput";
import ProjectsInput from "@/components/Projects/ProjectsInput";
import ProjectBadges from "@/components/ProjectBadges";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import Tooltip from "@/components/Tooltip/Tooltip";
import Markdown from "@/components/Markdown/Markdown";
import ShowLatestResults from "@/components/Experiment/ShowLatestResults";

const NUM_PER_PAGE = 20;

const CustomExperimentsPage = (): React.ReactElement => {
  const {
    ready,
    project,
    metrics,
    getMetricById,
    getProjectById,
  } = useDefinitions();

  const {
    experiments: allExperiments,
    error,
    mutateExperiments,
    loading,
  } = useExperiments(project);

  const { getUserDisplay } = useUser();
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsView, setResultsView] = useState("box");

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

  const showForm = useForm({
    defaultValues: {
      trackingkey: true,
      hypothesis: true,
      description: true,
      tags: true,
      projects: true,
      status: true,
      owner: true,
      created: true,
      dates: true,
      metrics: true,
      graphs: true,
      results: true,
      analysis: true,
      variations: true,
    },
  });
  const filterForm = useForm<{
    results: string[];
    status: string[];
    expType: string[];
    tags: string[];
    projects: string[];
    metrics: string[];
    owner: string;
    startDate: Date | null;
    endDate: Date | null;
  }>({
    defaultValues: {
      results: [],
      status: [],
      expType: [],
      tags: [],
      projects: [],
      metrics: [],
      owner: "",
      startDate: null,
      endDate: null,
    },
  });
  //console.log("showForm", showForm);
  const { items, searchInputProps, SortableTH } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: "date",
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
      owner,
      //startDate,
      //endDate,
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
    if (owner !== "") {
      console.log("filtering by owner", owner);
      filteredItems = filteredItems.filter((item) => {
        return item.ownerName?.toLowerCase().includes(owner.toLowerCase());
      });
    }
    if (tags.length) {
      filteredItems = filteredItems.filter((item) => {
        return tags.every((tag) => item.tags?.includes(tag));
      });
    }
    if (metrics.length) {
      filteredItems = filteredItems.filter((item) => {
        return metrics.every((m) => item.metrics?.includes(m));
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

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length, filtered.length]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (loading || !ready) {
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
  console.log(filtered);
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-5">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h3>Custom Experiment Reports</h3>
            </div>
            <div style={{ flex: 1 }} />
          </div>

          <div className="mb-3 appbox p-3">
            <div className="row align-items-top">
              <div className="col-5">
                <h4>Filter</h4>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Text search</label>
                  </div>
                  <div className="col-7">
                    <Field
                      placeholder="Search..."
                      type="search"
                      {...searchInputProps}
                    />
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Tags</label>
                  </div>
                  <div className="col-7">
                    <TagsInput
                      value={filterForm.watch("tags")}
                      onChange={(value) => {
                        filterForm.setValue("tags", value);
                      }}
                      prompt={"Filter by tags..."}
                      autoFocus={false}
                      closeMenuOnSelect={true}
                      creatable={false}
                    />
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Project</label>
                  </div>
                  <div className="col-7">
                    <ProjectsInput
                      value={filterForm.watch("projects")}
                      onChange={(value) => {
                        filterForm.setValue("projects", value);
                      }}
                      prompt={"Filter by project..."}
                      autoFocus={false}
                      closeMenuOnSelect={true}
                      creatable={false}
                    />
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Status</label>
                  </div>
                  <div className="col-7">
                    <MultiSelectField
                      value={filterForm.watch("status")}
                      options={[
                        { value: "draft", label: "Draft" },
                        { value: "running", label: "Running" },
                        { value: "stopped", label: "Stopped" },
                      ]}
                      onChange={(value: string[]) => {
                        filterForm.setValue("status", value);
                      }}
                    />
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Experiment Results</label>
                  </div>
                  <div className="col-7">
                    <MultiSelectField
                      value={filterForm.watch("results")}
                      options={[
                        { value: "won", label: "Won" },
                        { value: "lost", label: "Lost" },
                        { value: "inconclusive", label: "Inconclusive" },
                        { value: "dnf", label: "Did not finish" },
                      ]}
                      onChange={(value: string[]) => {
                        filterForm.setValue("results", value);
                      }}
                    />
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Owner</label>
                  </div>
                  <div className="col-7">
                    <Field
                      type="text"
                      placeholder=""
                      {...filterForm.register("owner")}
                      onChange={(e) => {
                        console.log(e.target.value);
                        filterForm.setValue("owner", e.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Start Dates</label>
                  </div>
                  <div className="col-7"></div>
                </div>
                <div className="row mb-2">
                  <div className="col-5">
                    <label>Metrics</label>
                  </div>
                  <div className="col-7">
                    <MultiSelectField
                      value={filterForm.watch("metrics")}
                      options={metrics.map((m) => ({
                        value: m.id,
                        label: m.name,
                      }))}
                      onChange={(value: string[]) => {
                        filterForm.setValue("metrics", value);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="col-6">
                <h4>Show:</h4>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"description"}
                      checked={!!showForm.watch("description")}
                      onChange={(e) => {
                        showForm.setValue("description", e.target.checked);
                      }}
                    />
                    Description
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"hypothesis"}
                      checked={!!showForm.watch("hypothesis")}
                      onChange={(e) => {
                        showForm.setValue("hypothesis", e.target.checked);
                      }}
                    />
                    Hypothesis
                  </label>
                </div>
                <div className="form-check form-check-inline">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"trackingkey"}
                      checked={!!showForm.watch("trackingkey")}
                      onChange={(e) => {
                        showForm.setValue("trackingkey", e.target.checked);
                      }}
                    />
                    Experiment Key
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"tags"}
                      checked={!!showForm.watch("tags")}
                      onChange={(e) => {
                        showForm.setValue("tags", e.target.checked);
                      }}
                    />
                    Tags
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"projects"}
                      checked={!!showForm.watch("projects")}
                      onChange={(e) => {
                        showForm.setValue("projects", e.target.checked);
                      }}
                    />
                    Projects
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"metrics"}
                      checked={!!showForm.watch("metrics")}
                      onChange={(e) => {
                        showForm.setValue("metrics", e.target.checked);
                      }}
                    />
                    Metrics
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"status"}
                      checked={!!showForm.watch("status")}
                      onChange={(e) => {
                        showForm.setValue("status", e.target.checked);
                      }}
                    />
                    Experiment status
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"results"}
                      checked={!!showForm.watch("variations")}
                      onChange={(e) => {
                        showForm.setValue("variations", e.target.checked);
                      }}
                    />
                    Variations
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"results"}
                      checked={!!showForm.watch("results")}
                      onChange={(e) => {
                        showForm.setValue("results", e.target.checked);
                      }}
                    />
                    Result
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"graphs"}
                      checked={!!showForm.watch("graphs")}
                      onChange={(e) => {
                        showForm.setValue("graphs", e.target.checked);
                      }}
                    />
                    Graphs
                  </label>
                </div>
                <div className="form-check">
                  <label>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"dates"}
                      checked={!!showForm.watch("dates")}
                      onChange={(e) => {
                        showForm.setValue("dates", e.target.checked);
                      }}
                    />
                    Dates
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="results-area">
            <div className="row justify-content-between mb-2">
              <div className="col">
                <h3 className="mb-0">
                  Showing {filtered.length} Experiment
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
                    }}
                    className={`${resultsView === "box" ? "selected" : ""}`}
                  >
                    <MdOutlineViewStream />
                  </a>
                </div>
              </div>
            </div>
          </div>
          {resultsView === "box" ? (
            <>
              {filtered.slice(start, end).map((e) => {
                const phase = e.phases?.[e.phases.length - 1];
                return (
                  <Fragment key={e.id}>
                    <div className="appbox mb-3 p-3">
                      <h3>
                        <Link href={`/experiment/${e.id}`}>{e.name}</Link>
                      </h3>
                      <div className="row">
                        <div className="col-6">
                          {showForm.watch("description") && (
                            <p>{e.description}</p>
                          )}
                          {showForm.watch("hypothesis") && (
                            <div className="mb-2">
                              <strong>Hypothesis:</strong>
                              {e?.hypothesis}
                            </div>
                          )}
                          {showForm.watch("trackingkey") && (
                            <div className="mb-2">
                              <strong>Experiment key:</strong>{" "}
                              <i>{e.trackingKey}</i>
                            </div>
                          )}
                          {showForm.watch("variations") && (
                            <div className="mb-2">
                              <strong>Variations:</strong>{" "}
                              {e?.variations.length > 0 &&
                              phase?.variationWeights.length > 0 ? (
                                <ul>
                                  {e?.variations?.map(
                                    ({ description, name }, i) => (
                                      <li key={i}>
                                        {name}{" "}
                                        {phase?.variationWeights.length > 0 && (
                                          <>
                                            {" - "}
                                            {phase?.variationWeights?.[i] *
                                              100 ?? "-"}
                                            %
                                          </>
                                        )}
                                        {description ? " - " + description : ""}
                                      </li>
                                    )
                                  )}
                                </ul>
                              ) : (
                                <>None</>
                              )}
                            </div>
                          )}
                          {showForm.watch("owner") && (
                            <div className="mb-2">
                              <strong>Owner:</strong> {e.ownerName}
                            </div>
                          )}
                          {showForm.watch("dates") && (
                            <div className="mb-2">
                              <strong>Created:</strong>{" "}
                              {datetime(e.dateCreated)}
                            </div>
                          )}
                          {showForm.watch("projects") && (
                            <div className="mb-2">
                              <strong>Project:</strong>
                              {e?.project ? (
                                <ProjectBadges
                                  projectIds={[e.project]}
                                  className="badge-ellipsis align-middle"
                                />
                              ) : (
                                <ProjectBadges className="badge-ellipsis align-middle" />
                              )}
                            </div>
                          )}
                          {showForm.watch("tags") && (
                            <div className="mb-2">
                              <strong>Tags:</strong>
                              <SortedTags tags={e.tags} />
                            </div>
                          )}
                        </div>
                        <div className="col-6">
                          {showForm.watch("results") && (
                            <p>
                              <strong>Status:</strong> {e.status}
                            </p>
                          )}
                          {showForm.watch("results") && (
                            <div>
                              <strong>Result:</strong>{" "}
                              {e.results ? (
                                <div className="d-inline-block">
                                  <ResultsIndicator
                                    results={e?.results ?? null}
                                  />
                                </div>
                              ) : (
                                <>N/A</>
                              )}
                            </div>
                          )}
                          {showForm.watch("analysis") && (
                            <p>
                              <strong>Analysis:</strong> {e.analysis}
                            </p>
                          )}
                          {showForm.watch("metrics") && (
                            <div>
                              <strong>Metric:</strong>
                              {e?.metrics.length > 0 ? (
                                <ul>
                                  {e?.metrics?.map((m, i) => (
                                    <li key={i}>
                                      {getMetricById(m)?.name ?? m}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <>None</>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {showForm.watch("graphs") && (
                        <div className="row">
                          <div className="col">
                            <ShowLatestResults experiment={e} />
                          </div>
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </>
          ) : (
            <div className="">
              <table className="appbox table experiment-table gbtable responsive-table mb-0">
                <thead
                  className="sticky-top bg-white shadow-sm"
                  style={{ top: "55px", zIndex: 900 }}
                >
                  <tr>
                    <SortableTH field={"name"} key={"name"} className={""}>
                      Name
                    </SortableTH>
                    {showForm.watch("description") && (
                      <SortableTH
                        field={"description"}
                        key={"description"}
                        className={""}
                      >
                        Description
                      </SortableTH>
                    )}
                    {showForm.watch("hypothesis") && (
                      <SortableTH
                        field={"hypothesis"}
                        key={"hypothesis"}
                        className={""}
                      >
                        Hypothesis
                      </SortableTH>
                    )}
                    {showForm.watch("owner") && (
                      <SortableTH field={"owner"} key={"owner"} className={""}>
                        Owner
                      </SortableTH>
                    )}
                    {showForm.watch("dates") && (
                      <SortableTH field={"date"} key={"date"} className={""}>
                        Started
                      </SortableTH>
                    )}
                    {showForm.watch("projects") && (
                      <SortableTH
                        field={"project"}
                        key={"project"}
                        className={""}
                      >
                        Project
                      </SortableTH>
                    )}
                    {showForm.watch("tags") && (
                      <SortableTH field={"tags"} key={"tags"} className={""}>
                        Tags
                      </SortableTH>
                    )}
                    {showForm.watch("status") && (
                      <SortableTH
                        field={"status"}
                        key={"status"}
                        className={""}
                      >
                        Status
                      </SortableTH>
                    )}
                    {showForm.watch("variations") && (
                      <SortableTH
                        field={"variations"}
                        key={"variations"}
                        className={""}
                      >
                        Variations
                      </SortableTH>
                    )}
                    {showForm.watch("results") && (
                      <SortableTH
                        field={"results"}
                        key={"results"}
                        className={""}
                      >
                        Results
                      </SortableTH>
                    )}
                    {showForm.watch("analysis") && (
                      <SortableTH
                        field={"analysis"}
                        key={"analysis"}
                        className={""}
                      >
                        Analysis
                      </SortableTH>
                    )}
                    {showForm.watch("metrics") && (
                      <SortableTH
                        field={"metrics"}
                        key={"metrics"}
                        className={""}
                      >
                        Metrics
                      </SortableTH>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(start, end).map((e) => {
                    const phase = e.phases?.[e.phases.length - 1];
                    return (
                      <tr key={e.id} className="hover-highlight">
                        <td
                          onClick={() => {
                            router.push(`/experiment/${e.id}`);
                          }}
                          className="cursor-pointer"
                          data-title="Experiment name:"
                        >
                          <div className="d-flex flex-column">
                            <div className="d-flex">
                              <Link href={`/experiment/${e.id}`}>
                                <a className="testname">{e.name}</a>
                              </Link>
                              {e.hasVisualChangesets ? (
                                <Tooltip
                                  className="d-flex align-items-center ml-2"
                                  body="Visual experiment"
                                >
                                  <RxDesktop className="text-blue" />
                                </Tooltip>
                              ) : null}
                              {(e.linkedFeatures || []).length > 0 ? (
                                <Tooltip
                                  className="d-flex align-items-center ml-2"
                                  body="Linked Feature Flag"
                                >
                                  <BsFlag className="text-blue" />
                                </Tooltip>
                              ) : null}
                            </div>
                            {showForm.watch("trackingkey") && e.trackingKey && (
                              <span
                                className="testid text-muted small"
                                title="Experiment Id"
                              >
                                {e.trackingKey}
                              </span>
                            )}
                          </div>
                        </td>
                        {showForm.watch("description") && (
                          <td>
                            <div className="" style={{ minWidth: 400 }}>
                              <Markdown className="">
                                {e.description || ""}
                              </Markdown>
                            </div>
                          </td>
                        )}
                        {showForm.watch("hypothesis") && (
                          <td>
                            <div className="" style={{ minWidth: 400 }}>
                              <Markdown className="">
                                {e.hypothesis || ""}
                              </Markdown>
                            </div>
                          </td>
                        )}
                        {showForm.watch("owner") && <td>{e.ownerName}</td>}
                        {showForm.watch("dates") && (
                          <td>{datetime(e.dateCreated)}</td>
                        )}
                        {showForm.watch("projects") && <td>{e.projectName}</td>}
                        {showForm.watch("tags") && (
                          <td>
                            <SortedTags tags={e.tags} />
                          </td>
                        )}
                        {showForm.watch("status") && <td>{e.status}</td>}
                        {showForm.watch("variations") && (
                          <td>
                            {e?.variations.length > 0 &&
                            phase?.variationWeights.length > 0 ? (
                              <div style={{ minWidth: 300 }}>
                                {e?.variations?.map(
                                  ({ description, name }, i) => (
                                    <div key={i}>
                                      {name}{" "}
                                      {phase?.variationWeights.length > 0 && (
                                        <>
                                          {" - "}
                                          {phase?.variationWeights?.[i] * 100 ??
                                            "-"}
                                          %
                                        </>
                                      )}
                                      {description ? " - " + description : ""}
                                    </div>
                                  )
                                )}
                              </div>
                            ) : (
                              <>None</>
                            )}
                          </td>
                        )}
                        {showForm.watch("results") && (
                          <td>
                            {e?.results ? (
                              <ResultsIndicator results={e.results} />
                            ) : (
                              <></>
                            )}
                          </td>
                        )}
                        {showForm.watch("analysis") && (
                          <td>
                            <div className="" style={{ minWidth: 400 }}>
                              <Markdown className="">
                                {e.analysis || ""}
                              </Markdown>
                            </div>
                          </td>
                        )}
                        {showForm.watch("metrics") && (
                          <td>
                            {e?.metrics.length > 0 && (
                              <>
                                {e?.metrics?.map((m, i) => (
                                  <div key={i} className="d-inline-block mr-2">
                                    <Link href={`/metric/${m}`}>
                                      {getMetricById(m)?.name ?? m}
                                    </Link>
                                  </div>
                                ))}
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
