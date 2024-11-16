import React, { useState, FC } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import useSDKConnections from "@/hooks/useSDKConnections";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Radix/Button";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();
  const router = useRouter();

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

  const { data: sdkConnectionsData } = useSDKConnections();

  const permissionsUtil = usePermissionsUtil();
  const canCreateProjects = permissionsUtil.canCreateProjects();

  return (
    <div className="container-fluid  pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <div className="filters md-form row mb-1 align-items-center">
        <div className="col-auto d-flex">
          <h1 className="mb-0">项目</h1>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <Tooltip
            body="您没有创建项目的权限"
            shouldDisplay={!canCreateProjects}
          >
            <Button
              disabled={!canCreateProjects}
              onClick={() => setModalOpen({})}
            >
              创建项目
            </Button>
          </Tooltip>
        </div>
      </div>

      <p className="text-gray mb-3">
        将您的想法和实验分组到 <strong>项目</strong> 中，以便保持条理清晰且易于管理。
      </p>
      {projects.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th className="col-3">项目名称</th>
              <th className="col-3">描述</th>
              <th className="col-2">编号</th>
              <th className="col-2">创建日期</th>
              <th className="col-2">更新日期</th>
              <th className="w-50"></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const canEdit = permissionsUtil.canUpdateProject(p.id);
              const canDelete = permissionsUtil.canDeleteProject(p.id);
              return (
                <tr
                  key={p.id}
                  onClick={
                    canEdit
                      ? () => {
                        router.push(`/project/${p.id}`);
                      }
                      : undefined
                  }
                  style={canEdit ? { cursor: "pointer" } : {}}
                >
                  <td>
                    {canEdit ? (
                      <Link
                        href={`/project/${p.id}`}
                        className="font-weight-bold"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-weight-bold">{p.name}</span>
                    )}
                  </td>
                  <td className="pr-5 text-gray" style={{ fontSize: 12 }}>
                    {p.description}
                  </td>
                  <td>{p.id}</td>
                  <td>{date(p.dateCreated)}</td>
                  <td>{date(p.dateUpdated)}</td>
                  <td
                    style={{ cursor: "initial" }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <MoreMenu>
                      {canEdit ? (
                        <button
                          className="btn dropdown-item"
                          onClick={() => {
                            setModalOpen(p);
                          }}
                        >
                          编辑
                        </button>
                      ) : null}
                      {canDelete ? (
                        <DeleteButton
                          className="dropdown-item text-danger"
                          displayName="项目"
                          text="删除"
                          useIcon={false}
                          onClick={async () => {
                            await apiCall(`/project/${p.id}`, {
                              method: "DELETE"
                            });
                            mutateDefinitions();
                          }}
                          additionalMessage={
                            sdkConnectionsData?.connections?.find((c) =>
                              c.projects.includes(p.id)
                            ) ? (
                              <div className="alert alert-danger px-2 py-1">
                                <FaExclamationTriangle /> 此项目正在被一个或多个SDK连接使用。删除它将导致这些连接停止工作。
                              </div>
                            ) : null
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
        <p>点击右上角的按钮来创建您的第一个项目！</p>
      )}
    </div>
  );
};
export default ProjectsPage;