import React, { FC, useState } from "react";
import { FaArchive, FaExclamationTriangle } from "react-icons/fa";
import router from "next/router";
import { date } from "shared/dates";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { GBPremiumBadge } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import MetricGroupModal from "@/components/Metrics/MetricGroupModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConfirmModal from "@/components/ConfirmModal";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Radix/Button";

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
        <div className="filters md-form row mb-3 align-items-center">
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
        <div className="alert alert-premium mt-2 p-3 p-4 text-center">
          <GBPremiumBadge
            className="text-premium"
            shouldDisplay={true}
            prependsText={true}
          />
          <span className="ml-2 text-premium font-weight-bold">
            Metric groups are a premium part of our Enterprise plan
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="filters md-form d-flex mb-0 align-items-center">
        <h1 className="mb-0">Metric Groups</h1>
        <div className="flex-1" />
        {canCreate && (
          <Button onClick={() => setOpenModal(true)}>Add Metric Group</Button>
        )}
      </div>
      <div className="mb-4">
        <p>
          Create groups of metrics that can be ordered and added to experiments.
        </p>
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
                            {mg.archived ? (
                              <button
                                className="dropdown-item"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  await updateArchiveState(mg, false);
                                  mutateDefinitions();
                                }}
                              >
                                Unarchive
                              </button>
                            ) : (
                              <button
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setArchiveModal(mg);
                                }}
                              >
                                Archive
                              </button>
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
                              <div className="alert alert-warning">
                                <FaExclamationTriangle className="mr-2" />
                                Metric groups are used by reference, which means
                                if you delete this group, all experiments using
                                it will be affected.
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
          <div className="appbox p-4 text-center">
            No metric groups defined. Click the button in the top right to
            create your first metric group.
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
