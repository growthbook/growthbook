import React, { FC, useCallback, useState } from "react";
import Link from "next/link";
import LoadingSpinner from "@/components/LoadingSpinner";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import Button from "../Button";

type DemoDataSourcePageProps = {
  error: string | null;
  success: string | null;
  ready: boolean;
  exists: boolean;
  onCreate: () => Promise<void>;
  onDelete: () => void | Promise<void>;
  demoFeatureId: string | null;
  demoExperimentId: string | null;
  demoDataSourceId: string | null;
};

export const DemoDataSourcePage: FC<DemoDataSourcePageProps> = ({
  onCreate,
  onDelete,
  success,
  error,
  ready,
  exists,
  demoExperimentId,
}) => {
  return (
    <div className="container-fluid pagecontents">
      <h1>Demo Project</h1>

      <div className="card p-4">
        {/* Intro section */}
        <p>This is a demo project with a fully working sample experiment.</p>
        <p>
          If you are done with this project, you can delete it here and all of
          the associated features, metrics, data sources, and experiments will
          be deleted as well.
        </p>
        {exists ? (
          <>
            <div className="d-flex mb-2">
              {demoExperimentId && (
                <Link href={`/experiment/${demoExperimentId}`}>
                  <a className="btn btn-primary mr-2">View Sample Experiment</a>
                </Link>
              )}
            </div>
          </>
        ) : null}

        {/* Loading */}
        {!ready && (
          <div className="d-flex justify-content-center my-4">
            <LoadingSpinner />
          </div>
        )}

        {/* Ready state */}
        {ready && (
          <div className="mt-3">
            {/* Success state when it has been created or deleted */}
            {success && (
              <>
                <div className="alert alert-success">{success}</div>
              </>
            )}

            {/* Error state */}
            {error && (
              <>
                <div className="alert alert-danger">{error}</div>
              </>
            )}

            {/* Create button */}
            {!exists && (
              <>
                <Button color="primary" onClick={onCreate}>
                  Create Demo Project
                </Button>
              </>
            )}

            {/* Delete button */}
            {exists && (
              <>
                {/* Only show already-exists messaging when not just created */}
                {!success && (
                  <div className="alert alert-info">
                    You already have a demo datasource project set up. You can
                    delete it here.
                  </div>
                )}

                <DeleteButton
                  displayName="Sample Data"
                  title="Sample Data"
                  text="Delete Sample Data"
                  outline={false}
                  onClick={onDelete}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const DemoDataSourcePageContainer = () => {
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    projectId: demoDataSourceProjectId,
    exists,
    demoFeatureId,
    demoDataSourceId,
    demoExperimentId,
  } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const { ready, mutateDefinitions } = useDefinitions();

  const onCreate = useCallback(async () => {
    setError(null);
    setSuccess(null);

    try {
      await apiCall("/demo-datasource-project", {
        method: "POST",
      });
      setSuccess("The demo data source project was created successfully.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(
          "An unknown error occurred when creating the demo datasource project"
        );
      }
    }
    mutateDefinitions();
  }, [apiCall, mutateDefinitions]);

  const onDelete = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (!demoDataSourceProjectId) return;

    try {
      await apiCall(
        `/projects/${demoDataSourceProjectId}?deleteExperiments=1&deleteFeatures=1&deleteMetrics=1&deleteSlackIntegrations=1&deleteDataSources=1`,
        {
          method: "DELETE",
        }
      );
      setSuccess("Demo datasource project was successfully deleted.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(
          "An unknown error occurred when deleting the demo datasource project"
        );
      }
    }
    mutateDefinitions();
  }, [apiCall, demoDataSourceProjectId, mutateDefinitions]);

  return (
    <DemoDataSourcePage
      ready={ready}
      success={success}
      error={error}
      exists={exists}
      onDelete={onDelete}
      onCreate={onCreate}
      demoFeatureId={demoFeatureId}
      demoDataSourceId={demoDataSourceId}
      demoExperimentId={demoExperimentId}
    />
  );
};
