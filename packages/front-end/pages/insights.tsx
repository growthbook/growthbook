import React, { useContext } from "react";
import useApi from "../hooks/useApi";
import Link from "next/link";
import { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { LearningInterface } from "back-end/types/insight";
import { date } from "../services/dates";
import { FaPlus } from "react-icons/fa";
import InsightForm from "../components/Insights/InsightForm";
import { UserContext } from "../components/ProtectedPage";
import { useSearch } from "../services/search";

const InsightsPage = (): React.ReactElement => {
  const { data: ld, error, mutate } = useApi<{
    learnings: LearningInterface[];
  }>("/learnings");
  const [current, setCurrent] = useState<Partial<LearningInterface>>(null);
  const { getUserDisplay } = useContext(UserContext);

  const {
    list: displayedLearnings,
    searchInputProps,
  } = useSearch(ld?.learnings || [], [
    "id",
    "text",
    "details",
    "tags",
    "evidence",
  ]);

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!ld) {
    return <LoadingOverlay />;
  }

  if (!ld.learnings.length) {
    return (
      <div className="container p-4">
        <h1>Insights</h1>
        <p>
          Insights are nuggets of information you&apos;ve learned from running
          lots of experiments.
        </p>
        <p>Some examples of insights you might learn from your users:</p>
        <ul>
          <li>Red buttons seem to have lower click-through-rates.</li>
          <li>
            Screenshots of our app convert better than stock photos of people
            using it.
          </li>
          <li>High quality product images make a huge difference.</li>
        </ul>
        <p>You can add experiments as evidence to back up your claims.</p>

        <button
          className="btn btn-success btn-lg"
          onClick={() => {
            setCurrent({});
          }}
        >
          <FaPlus /> Add your first Insight
        </button>

        {current && (
          <InsightForm
            close={() => setCurrent(null)}
            insight={current}
            mutate={mutate}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="container-fluid mt-3 pagecontents">
        <div className="row mb-3 filters">
          <div className="col-auto">
            <div className="">
              <input
                type="search"
                className=" form-control"
                placeholder="Search"
                {...searchInputProps}
              />
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="col-auto">
            <button
              className="btn btn-primary"
              onClick={() => {
                setCurrent({});
              }}
            >
              New Insight
            </button>
          </div>
        </div>
        <div className="row">
          {displayedLearnings.map((learn, i) => (
            <div className="col-md-4 col-sm-12 mb-4" key={i}>
              <div className="card h-100">
                <div className="card-body">
                  <div className="d-flex h-100 flex-column">
                    <h5 className="card-title">
                      <Link href="/insight/[lid]" as={`/insight/${learn.id}`}>
                        <a>{learn.text}</a>
                      </Link>
                    </h5>
                    <div style={{ flex: 1 }} />
                    <div className="text-muted">
                      <div className="mb-1">
                        By <strong>{getUserDisplay(learn.userId)}</strong> on{" "}
                        <strong>{date(learn.dateCreated)}</strong>
                      </div>
                      <div className="mb-1">
                        <span className="mr-2">Tags:</span>
                        {learn.tags?.length > 0 ? (
                          Object.values(learn.tags).map((col) => (
                            <span
                              className="tag badge badge-pill badge-info mr-2"
                              key={col}
                            >
                              {col}
                            </span>
                          ))
                        ) : (
                          <em>None</em>
                        )}
                      </div>
                      <div className="evidence ">
                        <span className="mr-2">
                          Evidence:{" "}
                          <code className="border px-1">
                            {learn.evidence.length}
                          </code>{" "}
                          experiment
                          {learn.evidence.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {current && (
        <InsightForm
          close={() => setCurrent(null)}
          insight={current}
          mutate={mutate}
        />
      )}
    </>
  );
};

export default InsightsPage;
