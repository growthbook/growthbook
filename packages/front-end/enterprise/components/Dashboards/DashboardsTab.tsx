import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useMemo, useState } from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { getDefaultDashboardSettingsForExperiment } from "shared/enterprise";
import { ago } from "shared/dates";
import { FaMagnifyingGlass } from "react-icons/fa6";
import Button from "@/components/Radix/Button";
import { useAuth } from "@/services/auth";
import Link from "@/components/Radix/Link";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardEditor from "./DashboardEditor";

interface Props {
  experiment: ExperimentInterfaceStringDates;
}

export default function DashboardsTab({ experiment }: Props) {
  const {
    dashboards: allDashboards,
    mutateDefinitions: mutate,
  } = useDefinitions();
  const dashboards = useMemo(
    () => allDashboards.filter((d) => d.experimentId === experiment.id),
    [allDashboards, experiment.id]
  );
  const [isEditing, setIsEditing] = useState(false);
  const [dashboard, setDashboard] = useState<
    DashboardInstanceInterface | undefined
  >(undefined);
  const { apiCall } = useAuth();

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: dashboards || [],
    localStorageKey: "savedGroups",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["title^3", "owner", "description^2"],
  });

  const permissionsUtil = usePermissionsUtil();
  const canDelete =
    permissionsUtil.canDeleteReport(experiment) ||
    permissionsUtil.canSuperDeleteReport();
  const canCreate = permissionsUtil.canCreateReport(experiment);

  if (isEditing || dashboard) {
    return (
      <DashboardEditor
        back={() => {
          setDashboard(undefined);
          setIsEditing(false);
        }}
        cancel={() => setIsEditing(false)}
        setEditing={setIsEditing}
        submit={async (dashboardData) => {
          const res = await apiCall<{
            status: number;
            dashboard: DashboardInstanceInterface;
          }>(`/dashboards/${dashboard?.id || ""}`, {
            method: dashboard ? "PUT" : "POST",
            body: JSON.stringify(
              dashboard
                ? dashboardData
                : { ...dashboardData, experimentId: experiment.id }
            ),
          });
          if (res.status === 200) {
            setDashboard(res.dashboard);
            setIsEditing(false);
            mutate();
          } else {
            console.error(res);
          }
        }}
        experiment={experiment}
        dashboard={dashboard}
        defaultSettings={getDefaultDashboardSettingsForExperiment(experiment)}
        isEditing={isEditing}
        mutate={mutate}
      />
    );
  }

  if (dashboards.length === 0) {
    return (
      <div className="mt-3">
        <div className="appbox mx-3 p-4">
          <div className="text-center">
            <h3>No Dashboards Yet</h3>
            <p className="text-muted mb-4">
              Create your first dashboard to analyze and share experiment
              results.
            </p>
            <Button
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Create New Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="appbox mx-3 p-4">
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h3>Dashboards</h3>
          </div>
          <div className="flex-1"></div>
          {canCreate && (
            <div className="col-auto">
              <Button
                onClick={() => {
                  setIsEditing(true);
                }}
              >
                Create New Dashboard
              </Button>
            </div>
          )}
        </div>
        <div>
          <p className="text-muted mb-1">Select a dashboard to view or edit.</p>
          <div className="row mb-4 align-items-center">
            <div className="col-auto">
              <Field
                prepend={<FaMagnifyingGlass />}
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
          </div>
          <div className="row mb-0">
            <div className="col-12">
              <table className="table gbtable">
                <thead>
                  <tr>
                    <SortableTH field="title">Name</SortableTH>
                    <th>Description</th>
                    <SortableTH field="owner">Owner</SortableTH>
                    <SortableTH field="dateUpdated">Date Updated</SortableTH>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dashboards.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link
                          className="text-color-primary"
                          onClick={() => setDashboard(d)}
                        >
                          {d.title}
                        </Link>
                      </td>
                      <td>{d.description}</td>
                      <td>{d.owner}</td>
                      <td>{ago(d.dateUpdated)}</td>
                      <td style={{ width: 30 }}>
                        <MoreMenu>
                          <DeleteButton
                            displayName="Dashboard"
                            className="dropdown-item text-danger"
                            useIcon={false}
                            text="Delete"
                            title="Delete Dashboard"
                            onClick={async () => {
                              await apiCall(`/dashboards/${d.id}`, {
                                method: "DELETE",
                              });
                              mutate();
                            }}
                            canDelete={canDelete}
                          />
                        </MoreMenu>
                      </td>
                    </tr>
                  ))}
                  {!items.length && isFiltered && (
                    <tr>
                      <td colSpan={5} align={"center"}>
                        No matching dashboards
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
