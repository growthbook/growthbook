import React, { FC, useState } from "react";
import { ArchetypeInterface } from "@back-end/types/archetype";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { GBAddCircle } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";

export const ArchetypeList: FC<{
  archetypes: ArchetypeInterface[];
  archetypeErrors: Error | undefined;
  mutate: () => void;
}> = ({ archetypes, archetypeErrors, mutate }) => {
  const [
    editArchetype,
    setEditArchetype,
  ] = useState<Partial<ArchetypeInterface> | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canUpdateArchetype();
  const canDelete = permissionsUtil.canDeleteArchetype();
  const canCreate = permissionsUtil.canCreateArchetype();

  const { apiCall } = useAuth();

  if (archetypeErrors) {
    return (
      <div className="alert alert-danger">
        An error occurred fetching the lists of archetypes.
      </div>
    );
  }

  return (
    <>
      <div className="row mb-3">
        <div className="col">
          <h1>Archetypes</h1>
        </div>
        {canCreate && (
          <div className="col-auto">
            <button
              className="btn btn-primary float-right"
              onClick={() => {
                setEditArchetype({});
                track("Viewed Add Archetype Modal", {
                  source: "archetype-list",
                });
              }}
              type="button"
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Archetype
            </button>
          </div>
        )}
      </div>
      <p className="text-gray mb-3">
        Archetypes are named sets of attributes that help you test your
        features.
      </p>
      <div className="mb-3">
        <div className={`mb-3`}>
          <table className="table gbtable appbox ">
            <thead>
              <tr>
                <th>Archetype</th>
                <th>Projects</th>
                <th>Public</th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {archetypes.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="text-center p-3 ">
                      No archetypes created. Click the &ldquo;Add
                      Archetype&rdquo; button to create one.
                      {!canCreate && (
                        <div className="text-muted small">
                          (You do not have permissions to create archetypes)
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                <></>
              )}
              {archetypes.map((archetype: ArchetypeInterface) => (
                <tr key={archetype.id} className={``}>
                  <td>
                    <Tooltip
                      body={
                        <>
                          <Code
                            code={JSON.stringify(
                              JSON.parse(archetype.attributes),
                              null,
                              2
                            )}
                            language="json"
                          />
                        </>
                      }
                    >
                      {archetype.name}
                      {archetype.description && (
                        <>
                          <br />
                          <span className="small text-muted">
                            {archetype.description}
                          </span>
                        </>
                      )}
                    </Tooltip>
                  </td>
                  <td>
                    {/* for the PR to be merged:
                      archetype.projects.map((project) => (
                        <div key={project.id}>
                          <Link href={`/project/${project.id}`}>
                            <a>{project.name}</a>
                          </Link>
                        </div>
                      ))*/}
                  </td>
                  <td>
                    {archetype.isPublic ? (
                      <span className="text-muted">Yes</span>
                    ) : (
                      <span className="text-muted">No</span>
                    )}
                  </td>
                  <td className={styles.showOnHover}>
                    <MoreMenu>
                      {canEdit ? (
                        <button
                          className="dropdown-item"
                          onClick={() => {
                            setEditArchetype(archetype);
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDelete ? (
                        <DeleteButton
                          className="dropdown-item"
                          displayName="Archetype"
                          text="Delete"
                          useIcon={false}
                          onClick={async () => {
                            await apiCall(`/archetype/${archetype.id}`, {
                              method: "DELETE",
                            });
                            await mutate();
                          }}
                        />
                      ) : null}
                    </MoreMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {editArchetype && (
            <ArchetypeAttributesModal
              close={async () => {
                setEditArchetype(null);
                await mutate();
              }}
              initialValues={editArchetype}
              header={
                Object.keys(editArchetype).length === 0
                  ? "Create Archetype"
                  : "Edit Archetype"
              }
            />
          )}
        </div>
      </div>
    </>
  );
};
