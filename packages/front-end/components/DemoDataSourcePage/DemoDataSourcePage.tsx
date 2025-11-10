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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type DemoDataSourcePageProps = {
  error: string | null;
  success: string | null;
  ready: boolean;
  exists: boolean;
  onCreate: () => Promise<void>;
  onDelete: () => void | Promise<void>;
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
      <h1>Sample Data</h1>

      <div className="card p-4">
        <p>
          If you are done with this sample data, you can delete it here and all
          of the associated features, metrics, data sources, and experiments
          will be deleted as well.
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
            {success && <div className="alert alert-success">{success}</div>}

            {/* Error state */}
            {error && <div className="alert alert-danger">{error}</div>}

            {/* Create button */}
            {!exists && (
              <Button color="primary" onClick={onCreate}>
                Create Demo Project
              </Button>
            )}

            {/* Delete button */}
            {exists && (
              <DeleteButton
                displayName="Sample Data"
                title="Sample Data"
                text="Delete Sample Data"
                outline={false}
                onClick={onDelete}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export async function deleteDemoDatasource(
  orgId: string | undefined,
  apiCall: AuthContextValue["apiCall"],
) {
  if (!orgId) throw new Error("Missing organization id");
  const demoDataSourceProjectId =
    getDemoDatasourceProjectIdForOrganization(orgId);
  await apiCall(
    `/projects/${demoDataSourceProjectId}?deleteExperiments=1&deleteFeatures=1&deleteMetrics=1&deleteSlackIntegrations=1&deleteDataSources=1&deleteFactTables=1`,
    {
      method: "DELETE",
    },
  );
}

export function DeleteDemoDatasourceButton({
  onDelete,
  source,
}: {
  onDelete: () => void;
  source: string;
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
      useRadix={true}
      onClick={async () => {
        track("Delete Sample Project", {
          source,
        });
        await deleteDemoDatasource(organization.id, apiCall);
        mutateDefinitions();

        if (project === demoProjectId) {
          setProject("");
        }

        onDelete();
      }}
      deleteMessage={
        <>
          <p>
            This will delete all sample data sources, metrics, experiments, and
            features.
          </p>
          <p>
            You can re-create this sample data at any time, but any changes you
            have made will be reverted back to the defaults.
          </p>
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

  const { organization } = useUser();

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
      setSuccess("The demo data source project was created successfully.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(
          "An unknown error occurred when creating the demo datasource project",
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
      track("Delete Sample Project", {
        source: "sample-project-page",
      });
      await deleteDemoDatasource(organization.id, apiCall);
      setSuccess("Demo datasource project was successfully deleted.");
    } catch (e: unknown) {
      console.error(e);

      if (typeof e === "string") {
        setError(e);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(
          "An unknown error occurred when deleting the demo datasource project",
        );
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
    organization.id,
    currentProjectIsDemo,
    setProject,
  ]);

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
