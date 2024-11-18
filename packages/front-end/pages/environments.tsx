import { useState, FC, useMemo } from "react";
import { Environment } from "back-end/types/organization";
import { isProjectListValidForProject } from "shared/util";
import { BsXCircle } from "react-icons/bs";
import { BiHide, BiShow } from "react-icons/bi";
import { ImBlocked } from "react-icons/im";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import OldButton from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import EnvironmentModal from "@/components/Settings/EnvironmentModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";

const EnvironmentsPage: FC = () => {
  const { project } = useDefinitions();

  const environments = useEnvironments();
  const filteredEnvironments = project
    ? environments.filter((env) =>
      isProjectListValidForProject(env.projects, project)
    )
    : environments;

  const { data: sdkConnectionData } = useSDKConnections();
  const sdkConnectionsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    sdkConnectionData?.connections?.forEach((c) => {
      map[c.environment] = map[c.environment] || [];
      map[c.environment].push(c.id);
    });
    return map;
  }, [sdkConnectionData]);

  const [showConnections, setShowConnections] = useState<number | null>(null);

  const { refreshOrganization } = useUser();
  // const permissions = usePermissions();
  const permissionsUtil = usePermissionsUtil();
  // See if the user has access to a random environment name that doesn't exist yet
  // If yes, then they can create new environments
  const canCreate = permissionsUtil.canCreateEnvironment({
    id: "",
    projects: [project],
  });

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<Environment> | null>(null);

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <EnvironmentModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => {
            refreshOrganization();
          }}
        />
      )}
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h1 className="mb-0">环境</h1>
        </div>
        {canCreate && (
          <div className="col-auto ml-auto">
            <Button onClick={() => setModalOpen({})}>添加环境</Button>
          </div>
        )}
      </div>

      <p className="text-gray mb-3">
        管理哪些环境可用于您的特性标志。
      </p>

      {filteredEnvironments.length > 0 ? (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>环境</th>
              <th>描述</th>
              <th className="col-2">项目</th>
              <th>SDK连接</th>
              <th>默认状态</th>
              <th>在特性列表中显示切换按钮</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredEnvironments.map((e, i) => {
              const canEdit = permissionsUtil.canUpdateEnvironment(e, {});
              const canDelete = permissionsUtil.canDeleteEnvironment(e);
              const sdkConnectionIds = sdkConnectionsMap?.[e.id] || [];
              const sdkConnections = (
                sdkConnectionData?.connections ?? []
              ).filter((c) => sdkConnectionIds.includes(c.id));
              const numConnections = sdkConnectionIds.length;
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
                  <td>
                    {(e?.projects?.length || 0) > 0 ? (
                      <ProjectBadges
                        resourceType="environment"
                        projectIds={e.projects}
                        className="badge-ellipsis short align-middle"
                      />
                    ) : (
                      <ProjectBadges
                        resourceType="environment"
                        className="badge-ellipsis short align-middle"
                      />
                    )}
                  </td>
                  <td>
                    <Tooltip
                      tipPosition="bottom"
                      state={showConnections === i}
                      popperStyle={{ marginLeft: 50 }}
                      body={
                        <div
                          className="px-3 py-2"
                          style={{ minWidth: 250, maxWidth: 350 }}
                        >
                          <a
                            role="button"
                            style={{ top: 3, right: 5 }}
                            className="position-absolute text-gray cursor-pointer"
                            onClick={(e) => {
                              e.preventDefault();
                              setShowConnections(null);
                            }}
                          >
                            <BsXCircle size={16} />
                          </a>
                          <div className="mt-1 text-muted font-weight-bold">
                            使用此环境的SDK连接
                          </div>
                          <div
                            className="mt-2"
                            style={{ maxHeight: 300, overflowY: "auto" }}
                          >
                            <ul className="pl-3 mb-0">
                              {sdkConnections.map((c, i) => (
                                <li
                                  key={i}
                                  className="my-1"
                                  style={{ maxWidth: 320 }}
                                >
                                  <a href={`/sdks/${c.id}`}>{c.name}</a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      }
                    >
                      <></>
                    </Tooltip>
                    {numConnections > 0 ? (
                      <>
                        <a
                          role="button"
                          className="link-purple nowrap"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowConnections(
                              showConnections !== i ? i : null
                            );
                          }}
                        >
                          {numConnections} connection
                          {numConnections !== 1 && "s"}
                          {showConnections === i ? (
                            <BiHide className="ml-2" />
                          ) : (
                            <BiShow className="ml-2" />
                          )}
                        </a>
                      </>
                    ) : (
                      <span className="font-italic text-muted">None</span>
                    )}
                  </td>
                  <td>{e.defaultState === false ? "off" : "on"}</td>
                  <td>{e.toggleOnList ? "yes" : "no"}</td>
                  <td style={{ width: 30 }}>
                    <MoreMenu>
                      {canEdit && (
                        <button
                          className="dropdown-item"
                          onClick={(ev) => {
                            ev.preventDefault();
                            setModalOpen(e);
                          }}
                        >
                          编辑
                        </button>
                      )}
                      {canEdit ? (
                        <>
                          {i > 0 && (
                            <OldButton
                              color=""
                              className="dropdown-item"
                              onClick={async () => {
                                const newEnvs = [...environments];
                                newEnvs.splice(i, 1);
                                newEnvs.splice(i - 1, 0, e);
                                await apiCall(`/environment/order`, {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    environments: newEnvs.map((env) => env.id),
                                  }),
                                });
                                refreshOrganization();
                              }}
                            >
                              上移
                            </OldButton>
                          )}
                          {i < environments.length - 1 && (
                            <OldButton
                              color=""
                              className="dropdown-item"
                              onClick={async () => {
                                const newEnvs = [...environments];
                                newEnvs.splice(i, 1);
                                newEnvs.splice(i + 1, 0, e);
                                await apiCall(`/environment/order`, {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    environments: newEnvs.map((env) => env.id),
                                  }),
                                });
                                refreshOrganization();
                              }}
                            >
                              下移
                            </OldButton>
                          )}
                        </>
                      ) : null}
                      {environments.length > 1 && canDelete && (
                        <Tooltip
                          shouldDisplay={numConnections > 0}
                          usePortal={true}
                          body={
                            <>
                              <ImBlocked className="text-danger" /> 此环境有{" "}
                              <strong>
                                {numConnections} 个SDK连接
                              </strong>{" "}
                              相关联。在{" "}
                              {numConnections === 1 ? "它被移除" : "它们被移除"}
                              之前，此环境无法被删除。
                            </>
                          }
                        >
                          <DeleteButton
                            deleteMessage="您确定要删除此环境吗？"
                            displayName={e.id}
                            className="dropdown-item text-danger"
                            text="删除"
                            useIcon={false}
                            onClick={async () => {
                              await apiCall(`/environment/${e.id}`, {
                                method: "DELETE",
                                body: JSON.stringify({
                                  settings: {
                                    environments: environments.filter(
                                      (env) => env.id !== e.id
                                    ),
                                  },
                                }),
                              });
                              refreshOrganization();
                            }}
                            disabled={numConnections > 0}
                          />
                        </Tooltip>
                      )}
                    </MoreMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : canCreate ? (
        <p>点击下面的按钮添加您的第一个环境</p>
      ) : (
        <p>您尚未定义任何环境。</p>
      )}
    </div>
  );
};
export default EnvironmentsPage;
