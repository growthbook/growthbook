import React, { FC, useCallback, useState } from "react";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import LoadingSpinner from "@/components/LoadingSpinner";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import { AuthContextValue, useAuth } from "@/services/auth";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import Button from "@/components/Button";
import UIButton from "@/ui/Button";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";

type DemoDataSourcePageProps = {
  error: string | null;
  success: string | null;
  ready: boolean;
  exists: boolean;
  onCreate: () => Promise<void>;
  onDelete: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
};

export const DemoDataSourcePage: FC<DemoDataSourcePageProps> = ({
  onCreate,
  onDelete,
  onReset,
  success,
  error,
  ready,
  exists,
}) => {
  return (
    <div className="container-fluid pagecontents">
      <h1>Sample Data</h1>

      <div className="card p-4">
        <p>
          When you are done exploring, delete the sample data here. This removes
          the sample Data Source and everything built on it — including Fact
          Tables, Fact Metrics, experiments, segments, dimensions, metric
          groups, and saved queries you created. Other resources that only live
          in the Sample Data Project are kept and moved to All Projects.
        </p>
        <p>
          You can also reset the seeded sample resources back to their original
          state without removing anything you created.
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
            {success && <Callout status="success">{success}</Callout>}

            {/* Error state */}
            {error && <Callout status="error">{error}</Callout>}

            {/* Create button */}
            {!exists && (
              <Button color="primary" onClick={onCreate}>
                Create Sample Data
              </Button>
            )}

            {/* Reset and delete buttons */}
            {exists && (
              <div className="d-flex">
                <UIButton variant="outline" onClick={onReset} mr="3">
                  Reset Sample Data
                </UIButton>
                <UIButton color="red" onClick={onDelete}>
                  Delete Sample Data
                </UIButton>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export async function deleteDemoDatasource(
  apiCall: AuthContextValue["apiCall"],
) {
  await apiCall(`/demo-datasource-project`, {
    method: "DELETE",
  });
}

export async function resetDemoDatasource(
  apiCall: AuthContextValue["apiCall"],
) {
  await apiCall(`/demo-datasource-project/reset`, {
    method: "POST",
  });
}

export function DeleteDemoDatasourceButton({
  onDelete,
  source,
  asLink,
}: {
  onDelete: () => void;
  source: string;
  asLink?: boolean;
}) {
  const { organization } = useUser();
  const { apiCall } = useAuth();
  const { mutateDefinitions, setProject, project } = useDefinitions();

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id,
  );

  const permissionsUtil = usePermissionsUtil();
  if (!permissionsUtil.canDeleteProject(demoProjectId)) {
    return null;
  }

  return (
    <DeleteButton
      displayName="Sample Data"
      title="Sample Data"
      text="Delete Sample Data"
      useRadix={!asLink}
      link={asLink}
      onClick={async () => {
        track("Delete Sample Project", {
          source,
        });
        await deleteDemoDatasource(apiCall);
        mutateDefinitions();

        if (project === demoProjectId) {
          setProject("");
        }

        onDelete();
      }}
      deleteMessage={
        <>
          <p>
            This deletes the sample Data Source and everything built on it —
            including Fact Tables, Fact Metrics, experiments, segments,
            dimensions, metric groups, and saved queries — plus the sample
            Feature Flag. Other resources that only live in the Sample Data
            Project are kept and moved to All Projects.
          </p>
          <p>You can re-create the sample data at any time.</p>
        </>
      }
    />
  );
}

export const DemoDataSourcePageContainer = () => {
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    projectId: demoDataSourceProjectId,
    currentProjectIsDemo,
    exists,
  } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const { ready, mutateDefinitions, setProject } = useDefinitions();

  const onCreate = useCallback(async () => {
    setError(null);
    setSuccess(null);

    try {
      await apiCall("/demo-datasource-project", {
        method: "POST",
      });
      track("Create Sample Project", {
        source: "sample-project-page",
      });
      setSuccess("The sample data was created successfully.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred when creating the sample data");
      }
    }
    mutateDefinitions();
  }, [apiCall, mutateDefinitions]);

  const onDelete = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (!demoDataSourceProjectId) return;

    try {
      track("Delete Sample Project", {
        source: "sample-project-page",
      });
      await deleteDemoDatasource(apiCall);
      setSuccess("The sample data was successfully deleted.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred when deleting the sample data");
      }
    }
    mutateDefinitions();
    if (currentProjectIsDemo) {
      setProject("");
    }
  }, [
    apiCall,
    demoDataSourceProjectId,
    mutateDefinitions,
    currentProjectIsDemo,
    setProject,
  ]);

  const onReset = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (!demoDataSourceProjectId) return;

    try {
      track("Reset Sample Project", {
        source: "sample-project-page",
      });
      await resetDemoDatasource(apiCall);
      setSuccess("The sample data was reset to its original state.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred when resetting the sample data");
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
      onReset={onReset}
    />
  );
};
