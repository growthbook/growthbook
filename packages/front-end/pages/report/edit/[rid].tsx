import { FC, useState, useEffect, FormEventHandler } from "react";
import useApi from "../../../hooks/useApi";
import { useRouter } from "next/router";
import {
  ReportInterface,
  QueryResult,
  Query,
  Visualization,
} from "../../../types/reports";
import LoadingOverlay from "../../../components/LoadingOverlay";
import SqlEditor from "../../../components/Report/SqlEditor";
import SchemaBrowser from "../../../components/Report/SchemaBrowser";
import ResultsTable from "../../../components/Report/ResultsTable";
import clsx from "clsx";
import { FaPlus, FaExternalLinkAlt } from "react-icons/fa";
import { useAuth } from "../../../services/auth";
import VisualizationEditor from "../../../components/Report/VisualizationEditor";
import Link from "next/link";

const EditReportPage: FC = () => {
  const router = useRouter();
  const { rid } = router.query;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState(0);
  const [visualization, setVisualization] = useState(-1);
  const [queries, setQueries] = useState<Query[]>([]);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [dirty, setDirty] = useState(false);

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    report: ReportInterface;
    results: QueryResult[];
    error?: string;
  }>(`/report/${rid}`);

  useEffect(() => {
    if (!data || dirty) return;
    setTitle(data.report.title);
    setDescription(data.report.description);
    setQueries(data.report.queries);
    setResults(data.results || []);
  }, [data]);

  if (error) {
    return <div>There was a problem loading the report</div>;
  }
  if (!data || !queries.length) {
    return <LoadingOverlay />;
  }

  const result = results[query] || {
    timestamp: new Date(),
    rows: [],
  };

  const updateQuery = (changes: Partial<Query>) => {
    const newQueries = [...queries];
    newQueries[query] = {
      ...newQueries[query],
      ...changes,
    };
    setQueries(newQueries);
    setDirty(true);
  };

  const addQuery = () => {
    setQuery(queries.length);
    setVisualization(-1);
    setQueries([
      ...queries,
      {
        query: "",
        source: null,
        showTable: true,
        visualizations: [],
      },
    ]);
    setDirty(true);
  };

  const addVisualization = () => {
    setVisualization(queries[query].visualizations.length);
    updateQuery({
      visualizations: [
        ...queries[query].visualizations,
        {
          title: "",
          type: "LineChart",
          xAxis: [],
          yAxis: [],
          color: "",
          options: {},
        },
      ],
    });
  };

  const updateVisualization = (changes: Partial<Visualization>) => {
    console.log(changes);
    const newVisualizations = [...queries[query].visualizations];
    newVisualizations[visualization] = {
      ...newVisualizations[visualization],
      ...changes,
    };
    console.log(newVisualizations);
    updateQuery({ visualizations: newVisualizations });
  };

  const setCode = (code: string) => {
    updateQuery({
      query: code,
    });
  };

  const onSubmit: FormEventHandler = async (e) => {
    e.preventDefault();

    await apiCall(`/report/${rid}`, {
      method: "PUT",
      body: JSON.stringify({
        title,
        description,
        queries,
      }),
    });

    setDirty(false);
    mutate();
  };

  return (
    <form className="container-fluid pagecontents my-3" onSubmit={onSubmit}>
      <div className="form-group">
        <h2>
          Edit Report
          <button
            type="submit"
            className={`btn ml-5 mr-2 btn-${dirty ? "primary" : "secondary"}`}
            disabled={!dirty}
          >
            {dirty ? "Save Changes" : "Saved"}
          </button>
          <Link href="/report/view/[rid]" as={`/report/view/${rid}`}>
            <a className="btn btn-link" target="_blank">
              <FaExternalLinkAlt className="mr-1" />
              View Report
            </a>
          </Link>
        </h2>
      </div>
      <div className="form-group">
        <input
          type="text"
          className="form-control mb-3"
          style={{ fontSize: "2rem" }}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder="Report Name"
        />
        <textarea
          className="form-control"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setDirty(true);
          }}
          style={{ height: "6em" }}
          placeholder="Report Description"
        />
      </div>
      <ul className="nav nav-tabs">
        {queries.map((q, i) => (
          <li className="nav-item" key={i}>
            <a
              className={clsx("nav-link", { active: i === query })}
              onClick={(e) => {
                e.preventDefault();
                setQuery(i);
                setVisualization(-1);
              }}
              href="#"
            >
              Query {i + 1}
            </a>
          </li>
        ))}
        <li className="nav-item ml-2">
          <a
            className="nav-link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              addQuery();
            }}
          >
            <FaPlus /> Add Query
          </a>
        </li>
      </ul>
      <div className="row mb-3">
        <div className="col-xl-10 col-lg-9 col-md-8">
          <SqlEditor code={queries[query].query} setCode={setCode} />
          {data.error ? (
            <div className="alert alert-danger">{data.error}</div>
          ) : (
            ""
          )}
        </div>
        <div className="col-xl-2 col-lg-3 col-md-4 pt-2">
          <SchemaBrowser />
        </div>
      </div>
      <div>
        <button className="btn btn-success mb-3" type="submit">
          Run Query
        </button>

        <ul className="nav nav-tabs">
          <li className="nav-item">
            <a
              className={clsx("nav-link", { active: visualization === -1 })}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setVisualization(-1);
              }}
            >
              Table
            </a>
          </li>
          {queries[query].visualizations.map((v, i) => (
            <li className="nav-item" key={i}>
              <a
                className={clsx("nav-link", { active: i === visualization })}
                onClick={(e) => {
                  e.preventDefault();
                  setVisualization(i);
                }}
                href="#"
              >
                {v.type}
              </a>
            </li>
          ))}
          <li className="nav-item ml-2">
            <a
              className="nav-link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                addVisualization();
              }}
            >
              <FaPlus /> Add Visualization
            </a>
          </li>
        </ul>
        {visualization === -1 ? (
          <ResultsTable {...result} />
        ) : (
          <VisualizationEditor
            visualization={queries[query].visualizations[visualization]}
            data={result}
            updateVisualization={updateVisualization}
          />
        )}
      </div>
    </form>
  );
};

export default EditReportPage;
