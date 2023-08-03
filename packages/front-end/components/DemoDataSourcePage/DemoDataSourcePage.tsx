import React, { FC, useCallback, useMemo, useState } from "react";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import LoadingSpinner from "@/components/LoadingSpinner";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";

type DemoDataSourcePageProps = {
  error: string | null;
  success: string | null;
  ready: boolean;
  exists: boolean;
  onCreate: () => void;
  onDelete: () => void;
};

export const DemoDataSourcePage: FC<DemoDataSourcePageProps> = ({
  onCreate,
  onDelete,
  success,
  error,
  ready,
  exists,
}) => {
  return (
    <div className="container-fluid pagecontents">
      <h1>Demo Datasource</h1>

      <div className="card p-4">
        {/* Intro section */}
        <p>Create a demo datasource project or delete the existing one.</p>
        <p>
          There are some restrictions when creating resources in this project.
        </p>
        <p>
          All created resources will be deleted when the project is deleted.
        </p>
        <p>
          If you accidentally delete something in the demo project and would
          like to restore it, you can delete the whole project and recreate it.
        </p>

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
                <button onClick={onCreate} className="btn btn-primary">
                  Create Demo Datasource Project
                </button>
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
                  displayName="Demo Datasource Project"
                  title="Demo Datasource Project"
                  text="Delete Demo Datasource Project"
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

  const { orgId, apiCall } = useAuth();
  const { getProjectById, ready } = useDefinitions();

  const demoDataSourceProjectId: string | null = orgId
    ? getDemoDatasourceProjectIdForOrganization(orgId)
    : null;

  const exists = useMemo((): boolean => {
    if (!demoDataSourceProjectId) return false;
    const demoProject = getProjectById(demoDataSourceProjectId);

    return !!demoProject;
  }, [getProjectById, demoDataSourceProjectId]);

  const onCreate = useCallback(async () => {
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
  }, [apiCall]);

  const onDelete = useCallback(async () => {
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
  }, [apiCall, demoDataSourceProjectId]);

  return (
    <DemoDataSourcePage
      ready={ready}
      success={success}
      error={error}
      exists={exists}
      onDelete={onDelete}
      onCreate={onCreate}
    />
  );
};
