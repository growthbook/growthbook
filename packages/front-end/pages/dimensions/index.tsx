import React, { FC, useContext, useState } from "react";
import { FaPlus, FaPencilAlt, FaTrash } from "react-icons/fa";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ago } from "../../services/dates";
import Button from "../../components/Button";
import { DimensionInterface } from "back-end/types/dimension";
import DimensionForm from "../../components/Dimensions/DimensionForm";
import { useDefinitions } from "../../services/DefinitionsContext";
import { hasFileConfig } from "../../services/env";
import clsx from "clsx";
import Link from "next/link";
import { UserContext } from "../../components/ProtectedPage";
import ConfirmModal from "../../components/ConfirmModal";
import { useAuth } from "../../services/auth";

const DimensionsPage: FC = () => {
  const {
    dimensions,
    datasources,
    getDatasourceById,
    ready,
    error,
    mutateDefinitions: mutate,
  } = useDefinitions();

  const { permissions } = useContext(UserContext);

  const [
    dimensionForm,
    setDimensionForm,
  ] = useState<null | Partial<DimensionInterface>>(null);

  const [
    deleteDimension,
    setDeleteDimension,
  ] = useState<DimensionInterface | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { apiCall } = useAuth();

  if (!error && !ready) {
    return <LoadingOverlay />;
  }

  const confirmDelete = async () => {
    if (deleteLoading) return;
    //console.log("lets delete ", deleteId);
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const res = await apiCall<{ status: number; message?: string }>(
        `/dimensions/${deleteDimension.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({ id: deleteDimension.id }),
        }
      );
      if (res.status === 200) {
        setDeleteLoading(false);
        setDeleteDimension(null);
        await mutate();
      } else {
        console.error(res);
        setDeleteError(
          res.message ||
            "There was an error submitting the form. Please try again."
        );
        setDeleteLoading(false);
        setDeleteDimension(null);
        //close();
      }
    } catch (e) {
      console.error(e);
      setDeleteError(e.message);
      setDeleteLoading(false);
      setDeleteDimension(null);
    }
  };

  const hasValidDataSources = !!datasources.filter(
    (d) => d.type !== "google_analytics"
  )[0];

  if (!hasValidDataSources) {
    return (
      <div className="p-3 container-fluid pagecontents">
        <div className="row mb-3">
          <div className="col">
            <h3>User Dimensions</h3>
          </div>
        </div>
        <div className="alert alert-info">
          Dimensions are only available if you connect GrowthBook to a
          compatible data source (Snowflake, Redshift, BigQuery, ClickHouse,
          Athena, Postgres, MySQL, Presto, or Mixpanel). Support for other data
          sources like Google Analytics is coming soon.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        There was an error loading the list of dimensions
      </div>
    );
  }

  return (
    <div className="p-3 container-fluid pagecontents">
      {dimensionForm && (
        <DimensionForm
          close={() => setDimensionForm(null)}
          current={dimensionForm}
        />
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <h3>User Dimensions</h3>
        </div>
        {!hasFileConfig() && permissions.createMetrics && (
          <div className="col-auto">
            <Button
              color="success"
              onClick={async () => {
                setDimensionForm({});
              }}
            >
              <FaPlus /> New User Dimension
            </Button>
          </div>
        )}
      </div>
      {dimensions.length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <p>
              User Dimensions are attributes of your users - for example,
              &quot;subscription plan&quot; or &quot;age group&quot;. In Growth
              Book, you can use these to drill down into experiment results.
            </p>
            <table
              className={clsx("table appbox", {
                "table-hover": !hasFileConfig(),
              })}
            >
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="d-none d-sm-table-cell">Data Source</th>
                  <th className="d-none d-lg-table-cell">Definition</th>
                  {!hasFileConfig() && <th>Date Updated</th>}
                  {!hasFileConfig() && <th></th>}
                </tr>
              </thead>
              <tbody>
                {dimensions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="d-none d-sm-table-cell">
                      {getDatasourceById(s.datasource)?.name}
                    </td>
                    <td className="d-none d-lg-table-cell">
                      {getDatasourceById(s.datasource)?.type === "mixpanel" ? (
                        <div>
                          Event property: <code>{s.sql}</code>
                        </div>
                      ) : (
                        <code>{s.sql}</code>
                      )}
                    </td>
                    {!hasFileConfig() && <td>{ago(s.dateUpdated)}</td>}
                    {!hasFileConfig() && (
                      <td>
                        <a
                          href="#"
                          className="tr-hover text-primary mr-3"
                          title="Edit this dimension"
                          onClick={(e) => {
                            e.preventDefault();
                            setDimensionForm(s);
                          }}
                        >
                          <FaPencilAlt />
                        </a>
                        <a
                          href="#"
                          className="tr-hover text-primary"
                          title="Delete this dimension"
                          onClick={(e) => {
                            e.preventDefault();
                            setDeleteDimension(s);
                          }}
                        >
                          <FaTrash />
                        </a>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!error &&
        dimensions.length === 0 &&
        !hasFileConfig() &&
        permissions.createMetrics && (
          <div className="alert alert-info">
            You don&apos;t have any user dimensions defined yet. Click the green
            button above to create your first one.
          </div>
        )}
      {!error && dimensions.length === 0 && hasFileConfig() && (
        <div className="alert alert-info">
          It looks like you have a <code>config.yml</code> file. Dimensions
          defined there will show up on this page.{" "}
          <a href="https://docs.growthbook.io/self-host/config#configyml">
            View Documentation
          </a>
        </div>
      )}

      <div>
        <h3>Experiment Dimensions</h3>
        <p>
          Experiment Dimensions are specific to the point-in-time that a user is
          put into an experiment - for example, &quot;browser&quot; or
          &quot;referrer&quot;. These are defined as part of your data source
          settings.
        </p>

        {permissions.organizationSettings && (
          <Link href="/settings/datasources">
            <a className="btn btn-outline-primary">View Data Sources</a>
          </Link>
        )}
      </div>
      {deleteDimension && (
        <ConfirmModal
          title="Are you sure you want to delete this dimension?"
          subtitle="This action cannot be undone"
          yesText="Yes, delete it"
          noText="Never mind"
          modalState={true}
          setModalState={() => {
            setDeleteDimension(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
      {deleteError}
    </div>
  );
};

export default DimensionsPage;
