import React, { FC, useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import router from "next/router";
import { date } from "shared/dates";
import { GBAddCircle } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import MetricGroupModal from "@/components/Metrics/MetricGroupModal";

const MetricGroupsPage: FC = () => {
  const [openModal, setOpenModal] = useState(false);
  const { metricGroups, mutateDefinitions, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateMetricGroup();
  const canDelete = permissionsUtil.canDeleteMetricGroup();
  const { apiCall } = useAuth();

  return (
    <div className="container-fluid  pagecontents">
      <div className="filters md-form row mb-1 align-items-center">
        <div className="col-auto">
          <h1 className="mb-0">Metric Groups</h1>
          <div>
            <p>
              Create groups of metrics that can be ordered and added to
              experiments
            </p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          {canCreate && (
            <button
              className="btn btn-primary float-right"
              onClick={() => {
                setOpenModal(true);
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Metric Group
            </button>
          )}
        </div>
      </div>
      <div>
        {metricGroups.length > 0 ? (
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <th className="col-3">Metric Group Name</th>
                <th className="col-4">Description</th>
                <th className="col-2">Datasource</th>
                <th className="col-2">metrics</th>
                <th className="col-2">Date Created</th>
                <th style={{ width: "50px" }}></th>
              </tr>
            </thead>
            <tbody>
              {metricGroups.map((mg) => {
                const dsName = getDatasourceById(mg.datasource)?.name || "-";
                return (
                  <tr
                    key={mg.id}
                    onClick={() => {
                      router.push(`/metric-groups/${mg.id}`);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <a className="font-weight-bold">{mg.name}</a>
                    </td>
                    <td className="pr-5 text-gray" style={{ fontSize: 12 }}>
                      {mg.description}
                    </td>
                    <td>{dsName}</td>
                    <td>{mg.metrics.length}</td>
                    <td>{date(mg.dateCreated)}</td>
                    <td
                      className="text-right"
                      style={{ cursor: "initial", width: "50px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <MoreMenu>
                        {canDelete ? (
                          <DeleteButton
                            className="dropdown-item text-danger"
                            displayName="project"
                            text="Delete"
                            useIcon={false}
                            onClick={async () => {
                              await apiCall(`/metric-group/${mg.id}`, {
                                method: "DELETE",
                              });
                              mutateDefinitions();
                            }}
                            additionalMessage={
                              <div className="alert alert-info px-2 py-1">
                                <FaExclamationTriangle /> Metric groups are used
                                by reference, which means if you delete this
                                group, all experiments using it will be
                                affected.
                              </div>
                            }
                          />
                        ) : null}
                      </MoreMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="text-center p-4">
            <p>
              No metric groups defined. Click the button in the top right to
              create your first metric group
            </p>
          </div>
        )}
      </div>
      {openModal && (
        <MetricGroupModal
          close={() => setOpenModal(false)}
          mutate={mutateDefinitions}
        />
      )}
    </div>
  );
};
export default MetricGroupsPage;
