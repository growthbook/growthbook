import React, { FC, Fragment } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { datetime } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import SortedTags from "@/components/Tags/SortedTags";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import ShowLatestResults from "@/components/Experiment/ShowLatestResults";
import Tooltip from "@/components/Tooltip/Tooltip";
import Markdown from "@/components/Markdown/Markdown";

const ExperimentCustomSearchResults: FC<{
  filtered;
  start: number;
  end: number;
  showForm;
  SortableTH;
  resultsView;
}> = ({ filtered, start, end, showForm, SortableTH, resultsView }) => {
  const { getDatasourceById, getMetricById } = useDefinitions();
  const router = useRouter();

  return (
    <>
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
                      {showForm.watch("description") && <p>{e.description}</p>}
                      {showForm.watch("hypothesis") && (
                        <div className="mb-2">
                          <strong>Hypothesis:</strong>
                          {e?.hypothesis}
                        </div>
                      )}
                      {showForm.watch("trackingKey") && (
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
                                        {phase?.variationWeights?.[i] * 100 ??
                                          "-"}
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
                      {showForm.watch("ownerName") && (
                        <div className="mb-2">
                          <strong>Owner:</strong> {e.ownerName}
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
                      {showForm.watch("status") && (
                        <div className="mb-2">
                          <strong>Status:</strong> {e.status}
                        </div>
                      )}
                      {showForm.watch("startDate") && (
                        <div className="mb-2">
                          <strong>
                            {e.status === "draft" ? "Created" : "Started"}:
                          </strong>{" "}
                          {datetime(e.startDate)}
                        </div>
                      )}
                      {showForm.watch("endDate") && (
                        <div className="mb-2">
                          <strong>Ended:</strong> {datetime(e.endDate)}
                        </div>
                      )}
                      {showForm.watch("results") && (
                        <div>
                          <strong>Result:</strong>{" "}
                          {e.results ? (
                            <div className="d-inline-block">
                              <ResultsIndicator results={e?.results ?? null} />
                            </div>
                          ) : (
                            <>N/A</>
                          )}
                        </div>
                      )}
                      {showForm.watch("analysis") && (
                        <div className="mb-2">
                          <strong>Analysis:</strong> {e.analysis}
                        </div>
                      )}
                      {showForm.watch("dataSources") && (
                        <div>
                          <strong>Data Source:</strong>{" "}
                          {getDatasourceById(e?.datasource)?.name || "-"}
                        </div>
                      )}
                      {showForm.watch("metrics") && (
                        <div>
                          <strong>Metric:</strong>
                          {e?.metrics.length > 0 ? (
                            <ul>
                              {e?.metrics?.map((m, i) => (
                                <li key={i}>{getMetricById(m)?.name ?? m}</li>
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
                {showForm.watch("ownerName") && (
                  <SortableTH
                    field={"ownerName"}
                    key={"ownerName"}
                    className={""}
                  >
                    Owner
                  </SortableTH>
                )}
                {showForm.watch("startDate") && (
                  <SortableTH
                    field={"startDate"}
                    key={"startDate"}
                    className={""}
                  >
                    Started
                  </SortableTH>
                )}
                {showForm.watch("endDate") && (
                  <SortableTH field={"endDate"} key={"endDate"} className={""}>
                    Ended
                  </SortableTH>
                )}
                {showForm.watch("projects") && (
                  <SortableTH field={"project"} key={"project"} className={""}>
                    Project
                  </SortableTH>
                )}
                {showForm.watch("tags") && (
                  <SortableTH field={"tags"} key={"tags"} className={""}>
                    Tags
                  </SortableTH>
                )}
                {showForm.watch("status") && (
                  <SortableTH field={"status"} key={"status"} className={""}>
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
                  <SortableTH field={"results"} key={"results"} className={""}>
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
                {showForm.watch("dataSources") && (
                  <SortableTH field={"datasource"} key={"datasource"}>
                    Data Source
                  </SortableTH>
                )}
                {showForm.watch("metrics") && (
                  <SortableTH field={"metrics"} key={"metrics"} className={""}>
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
                      <div
                        className="d-flex flex-column"
                        style={{ minWidth: 200 }}
                      >
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
                        {showForm.watch("trackingKey") && e.trackingKey && (
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
                          <Markdown className="">{e.hypothesis || ""}</Markdown>
                        </div>
                      </td>
                    )}
                    {showForm.watch("ownerName") && <td>{e.ownerName}</td>}
                    {showForm.watch("startDate") && (
                      <td style={{ minWidth: 100 }}>{datetime(e.startDate)}</td>
                    )}
                    {showForm.watch("endDate") && (
                      <td style={{ minWidth: 100 }}>{datetime(e.endDate)}</td>
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
                            {e?.variations?.map(({ description, name }, i) => (
                              <div key={i}>
                                {name}{" "}
                                {phase?.variationWeights.length > 0 && (
                                  <>
                                    {" - "}
                                    {phase?.variationWeights?.[i] * 100 ?? "-"}%
                                  </>
                                )}
                                {description ? " - " + description : ""}
                              </div>
                            ))}
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
                          <Markdown className="">{e.analysis || ""}</Markdown>
                        </div>
                      </td>
                    )}
                    {showForm.watch("dataSources") && (
                      <td>{getDatasourceById(e?.datasource)?.name || "-"}</td>
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
    </>
  );
};

export default ExperimentCustomSearchResults;
