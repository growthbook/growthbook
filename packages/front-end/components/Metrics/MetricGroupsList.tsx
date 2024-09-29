import React, { FC, useState } from "react";
import { FaArchive, FaExclamationTriangle } from "react-icons/fa";
import router from "next/router";
import { date } from "shared/dates";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { GBAddCircle, GBPremiumBadge } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import MetricGroupModal from "@/components/Metrics/MetricGroupModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConfirmModal from "@/components/ConfirmModal";
import { useUser } from "@/services/UserContext";

const MetricGroupsList: FC = () => {
  const [openModal, setOpenModal] = useState(false);
  const [editModal, setEditModal] = useState<MetricGroupInterface | null>(null);
  const [archiveModal, setArchiveModal] = useState<MetricGroupInterface | null>(
    null
  );
  const {
    metricGroups,
    mutateDefinitions,
    getDatasourceById,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const hasGroupsFeature = hasCommercialFeature("metric-groups");

  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canUpdateMetricGroup();
  const canCreate = permissionsUtil.canCreateMetricGroup();
  const canDelete = permissionsUtil.canDeleteMetricGroup();
  const { apiCall } = useAuth();

  const updateArchiveState = async (
    metricGroup: MetricGroupInterface,
    archived: boolean
  ) => {
    await apiCall<{ metricGroup: MetricGroupInterface }>(
      `/metric-group/${metricGroup.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          archived: archived,
        }),
      }
    );
  };

  if (!hasGroupsFeature) {
    return (
      <div className="">
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
        </div>
        <div className="alert alert-info-gb-purple mt-2 p-3 p-4 text-center">
          <GBPremiumBadge
            className="text-premium"
            shouldDisplay={true}
            prependsText={true}
          />
          <span className="ml-2 text-premium font-weight-bold">
            Metric groups is a premium as part of our enterprise plan
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="">
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
        {metricGroups?.length > 0 ? (
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <th className="col-3">Metric Group Name</th>
                <th className="col-4">Description</th>
                <th className="col-2">Datasource</th>
                <th className="col-2">metrics</th>
                <th className="col-2">Date Created</th>
                <th></th>
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
                    style={{
                      cursor: "pointer",
                      opacity: mg.archived ? 0.65 : 1,
                    }}
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
                    <td className="text-muted">
                      {mg.archived && (
                        <Tooltip
                          body={"Archived"}
                          innerClassName="p-2"
                          tipMinWidth="auto"
                        >
                          <FaArchive />
                        </Tooltip>
                      )}
                    </td>
                    <td
                      className="text-right"
                      style={{ cursor: "initial", width: "50px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <MoreMenu>
                        {canEdit ? (
                          <>
                            <div
                              className="dropdown-item"
                              onClick={(e) => {
                                e.preventDefault();
                                setEditModal(mg);
                              }}
                            >
                              <a href="#">Edit</a>
                            </div>
                            {mg.archived ? (
                              <div
                                className="dropdown-item"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  await updateArchiveState(mg, false);
                                  mutateDefinitions();
                                }}
                              >
                                <a href="#">Unarchive</a>
                              </div>
                            ) : (
                              <div
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setArchiveModal(mg);
                                }}
                              >
                                <a href="#">Archive</a>
                              </div>
                            )}
                          </>
                        ) : null}
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
      {editModal && (
        <MetricGroupModal
          close={() => setEditModal(null)}
          mutate={mutateDefinitions}
          existingMetricGroup={editModal}
        />
      )}
      {archiveModal && (
        <ConfirmModal
          title={"Archive this metric group"}
          subtitle="This will archive this metric group. It will not be selectable in new experiments or reports."
          yesText="Archive"
          noText="Cancel"
          modalState={!!archiveModal}
          setModalState={(state) => {
            if (!state) setArchiveModal(null);
          }}
          onConfirm={async () => {
            await updateArchiveState(archiveModal, true);
            mutateDefinitions();
            setArchiveModal(null);
          }}
        />
      )}
      {openModal && (
        <MetricGroupModal
          close={() => setOpenModal(false)}
          mutate={mutateDefinitions}
        />
      )}
    </div>
  );
};
export default MetricGroupsList;
