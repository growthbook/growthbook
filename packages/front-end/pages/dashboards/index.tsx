import { ago } from "shared/dates";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { useCallback, useEffect, useState } from "react";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDashboards } from "@/hooks/useDashboards";
import { useSearch } from "@/services/search";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import DashboardModal from "@/enterprise/components/Dashboards/DashboardModal";
import {
  CreateDashboardArgs,
  SubmitDashboard,
  UpdateDashboardArgs,
} from "@/enterprise/components/Dashboards/DashboardsTab";
import { useAuth } from "@/services/auth";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

export default function DashboardsPage() {
  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
  const { apiCall } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dashboardId, setDashboardId] = useState("");
  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const { dashboards, loading, error, mutateDashboards } = useDashboards(false);
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: dashboards,
    localStorageKey: "dashboards",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["title"],
  });
  const canCreate = permissionsUtil.canCreateGeneralDashboards({
    projects: [project],
  });

  const dashboard = dashboards.find((d) => d.id === dashboardId);

  useEffect(() => {
    if (dashboard) {
      setBlocks(dashboard.blocks);
    } else {
      setBlocks([]);
    }
  }, [dashboard]);

  const submitDashboard = useCallback<
    SubmitDashboard<CreateDashboardArgs | UpdateDashboardArgs>
  >(
    async ({ method, dashboardId, data }) => {
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(`/dashboards/${method === "PUT" ? dashboardId : ""}`, {
        method: method,
        body: JSON.stringify(
          method === "PUT"
            ? {
                blocks: data.blocks,
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                projects: project ? [project] : [],
              }
            : {
                blocks: data.blocks ?? [],
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                experimentId: "",
                projects: project ? [project] : [],
              },
        ),
      });
      if (res.status === 200) {
        mutateDashboards();
        setDashboardId(res.dashboard.id);
        setBlocks(res.dashboard.blocks);
      } else {
        console.error(res);
      }
    },
    [apiCall, mutateDashboards, project],
  );

  if (loading) return <LoadingOverlay />;

  return (
    <>
      {isEditing && dashboard && (
        <DashboardWorkspace
          experiment={null}
          dashboard={dashboard}
          submitDashboard={submitDashboard}
          mutate={mutateDashboards}
          close={() => setIsEditing(false)}
          isTabActive={true} // MK: This doesn't really make sense for general dashboards
        />
      )}
      {showCreateModal && (
        <DashboardModal
          mode="create"
          close={() => setShowCreateModal(false)}
          submit={async (data) => {
            await submitDashboard({ method: "POST", data });
            setIsEditing(true);
          }}
        />
      )}
      <div className="p-3 container-fluid pagecontents">
        <div className="row">
          <div className="col">
            <h1>Dashboards</h1>
          </div>
        </div>

        {error ? (
          <div className="alert alert-danger">
            There was an error loading the list of dashboards.
          </div>
        ) : (
          <>
            <div className="row mb-4 align-items-center justify-content-between">
              <div className="col-auto">
                <Field
                  prepend={<FaMagnifyingGlass />}
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </div>
              <Button
                onClick={() => setShowCreateModal(true)}
                disabled={!canCreate}
              >
                Create Dashboard
              </Button>
            </div>
            <div className="row mb-0">
              <div className="col-12">
                <table className="table gbtable">
                  <thead>
                    <tr>
                      <SortableTH field={"title"}>Title</SortableTH>
                      <th>Owner</th>
                      <SortableTH field={"dateCreated"}>
                        Date Created
                      </SortableTH>
                      <SortableTH field={"dateUpdated"}>
                        Date Updated
                      </SortableTH>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => {
                      const canEdit =
                        permissionsUtil.canUpdateGeneralDashboards(d, {});
                      const canDelete =
                        permissionsUtil.canDeleteGeneralDashboards(d);
                      return (
                        <tr key={d.id}>
                          <td>
                            <Link
                              className="text-color-primary"
                              key={d.id}
                              href={`/dashboards/${d.id}`}
                            >
                              {d.title}
                            </Link>
                          </td>
                          <td>{d.userId}</td>
                          <td>{ago(d.dateCreated)}</td>
                          <td>{ago(d.dateUpdated)}</td>
                          <td style={{ width: 30 }}>
                            <MoreMenu>
                              {canDelete ? (
                                <DeleteButton
                                  displayName="Dashboard"
                                  className="dropdown-item text-danger"
                                  text="Delete"
                                  useIcon={false}
                                  title="Delete this dashboard"
                                  onClick={async () => {
                                    await apiCall(`/dashboards/${d.id}`, {
                                      method: "DELETE",
                                    });
                                    mutateDashboards();
                                  }}
                                />
                              ) : null}
                            </MoreMenu>
                          </td>
                        </tr>
                      );
                    })}
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
          </>
        )}
      </div>
    </>
  );
}
