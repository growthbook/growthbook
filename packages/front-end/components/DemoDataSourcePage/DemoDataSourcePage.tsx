import React, { FC, useCallback, useMemo, useState } from "react";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import LoadingSpinner from "@/components/LoadingSpinner";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";

type DemoDataSourcePageProps = {
  success: boolean;
  ready: boolean;
  exists: boolean;
  onCreate: () => void;
  onDelete: () => void;
};

export const DemoDataSourcePage: FC<DemoDataSourcePageProps> = ({
  onCreate,
  onDelete,
  success,
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
            {/* Success state when it has been created */}
            {success && (
              <>
                <div className="alert alert-success">
                  The demo data source project was created successfully.
                </div>
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
  const [success, setSuccess] = useState(false);

  const { orgId } = useAuth();
  const { getProjectById, ready } = useDefinitions();

  const exists = useMemo((): boolean => {
    if (!orgId) return false;
    const demoProjectId = getDemoDatasourceProjectIdForOrganization(orgId);
    const demoProject = getProjectById(demoProjectId);

    return !!demoProject;
  }, [getProjectById, orgId]);

  const onCreate = useCallback(() => {
    // TODO: Create
  }, []);

  const onDelete = useCallback(() => {
    // TODO: Create
  }, []);

  return (
    <DemoDataSourcePage
      ready={ready}
      success={success}
      exists={exists}
      onDelete={onDelete}
      onCreate={onCreate}
    />
  );
};
