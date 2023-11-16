import React, { FC, FormEvent, ReactNode, useCallback } from "react";
import { FaUpload } from "react-icons/fa";
import { BsCheck, BsDash, BsX } from "react-icons/bs";
import Link from "next/link";
import {
  ImportTaskResults,
  useImportFromLaunchDarkly,
} from "@/components/importing/ImportFromLaunchDarkly/useImportFromLaunchDarkly";
import LoadingSpinner from "@/components/LoadingSpinner";
import { GBCircleArrowLeft } from "@/components/Icons";

type ImportFromLaunchDarklyProps = {
  status: "idle" | "pending" | "completed";
  errors: string[];
  results: ImportTaskResults;
  onSubmit(apiToken: string): Promise<void>;
};

export const ImportFromLaunchDarkly: FC<ImportFromLaunchDarklyProps> = ({
  onSubmit,
  errors,
  results,
  status,
}) => {
  const handleSubmit = useCallback(
    (evt: FormEvent<HTMLFormElement>) => {
      evt.preventDefault();

      const form = evt.currentTarget as HTMLFormElement;
      const apiKey = form.elements["api_token"].value;

      onSubmit(apiKey);
    },
    [onSubmit]
  );

  return (
    <div className="">
      <div className="mb-4">
        <Link href="/importing">
          <GBCircleArrowLeft />
          Back to Importing
        </Link>
      </div>

      <h1>Import from LaunchDarkly</h1>
      <p>
        Import your data from LaunchDarkly. Just provide a LaunchDarkly API key
        or personal access token to proceed.
      </p>
      <p>
        This task will attempt to import the following resources from
        LaunchDarkly:
      </p>
      <ul>
        <li>Projects</li>
        <li>Environments</li>
        <li>Feature flags</li>
      </ul>
      <p>Duplicate items will not be imported.</p>
      <p>
        Read the{" "}
        <a
          target="_blank"
          href="https://docs.growthbook.io/guide/importing"
          rel="noreferrer"
        >
          documentation
        </a>{" "}
        for more info.
      </p>

      <form className="mt-4" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="text-muted font-weight-bold" htmlFor="api_token">
            LaunchDarkly API token
          </label>
          <input
            className="form-control"
            style={{ maxWidth: 400 }}
            type="text"
            name="api_token"
            id="api_token"
            required
          />
        </div>
        <button className="btn btn-primary" type="submit">
          <FaUpload /> Start Import
        </button>
      </form>

      {/* General errors */}
      {errors.length > 0 && (
        <div className="my-4">
          {errors.map((error) => (
            <div className="alert alert-danger" key={error}>
              {error}
            </div>
          ))}
        </div>
      )}

      {/* Loading spinner for pending state */}
      {status === "pending" && (
        <div className="my-4 d-sm-flex justify-content-center">
          <LoadingSpinner />
        </div>
      )}
      {status === "completed" && (
        <div className="mt-4 alert alert-info">Import complete</div>
      )}

      {/* region Project Results */}
      {results.projects.taskResults.length > 0 && (
        <div className="card p-4 my-4">
          <h2>Results &rarr; Projects</h2>

          {results.projects.taskResults.map((result) => (
            <p key={result.message} className="d-sm-flex align-items-center">
              {getIconForTaskResultState(result.status)}{" "}
              <span className="ml-2">{result.message}</span>
            </p>
          ))}
        </div>
      )}
      {/* endregion Project Results */}

      {/* region Environment Results */}
      {results.environments.taskResults.length > 0 && (
        <div className="card p-4 my-4">
          <h2>Results &rarr; Environments</h2>

          {results.environments.taskResults.map((result) => (
            <p key={result.message} className="d-sm-flex align-items-center">
              {getIconForTaskResultState(result.status)}{" "}
              <span className="ml-2">{result.message}</span>
            </p>
          ))}
        </div>
      )}
      {/* endregion Environment Results */}

      {/* region Feature Results */}
      {results.features.taskResults.length > 0 && (
        <div className="card p-4 my-4">
          <h2>Results &rarr; Features</h2>

          {results.features.taskResults.map((result) => (
            <p key={result.message} className="d-sm-flex align-items-center">
              {getIconForTaskResultState(result.status)}{" "}
              <span className="ml-2">{result.message}</span>
            </p>
          ))}
        </div>
      )}
      {/* endregion Feature Results */}
    </div>
  );
};

const getIconForTaskResultState = (
  state: "failed" | "completed" | "ignored"
): ReactNode => {
  switch (state) {
    case "completed":
      return <BsCheck className="d-block text-success" />;
    case "failed":
      return <BsX className="d-block text-danger" />;
    case "ignored":
      return <BsDash className="d-block text-muted" />;
    default:
      return null;
  }
};

export const ImportFromLaunchDarklyContainer = () => {
  const {
    errors,
    performImport,
    results,
    status,
  } = useImportFromLaunchDarkly();

  return (
    <ImportFromLaunchDarkly
      errors={errors}
      results={results}
      onSubmit={performImport}
      status={status}
    />
  );
};
