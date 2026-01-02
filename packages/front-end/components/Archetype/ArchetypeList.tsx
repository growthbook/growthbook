import React, { FC, useState } from "react";
import { ArchetypeInterface } from "shared/types/archetype";
import Link from "next/link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";

export const ArchetypeList: FC<{
  archetypes: ArchetypeInterface[];
  archetypeErrors: Error | undefined;
  mutate: () => void;
}> = ({ archetypes, archetypeErrors, mutate }) => {
  const [editArchetype, setEditArchetype] =
    useState<Partial<ArchetypeInterface> | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const { project, getProjectById } = useDefinitions();
  const { getUserDisplay, hasCommercialFeature } = useUser();

  const hasArchetypeFeature = hasCommercialFeature("archetypes");
  const canCreateGlobal = permissionsUtil.canCreateArchetype({
    projects: [project],
  });
  const { apiCall } = useAuth();

  if (archetypeErrors) {
    return (
      <div className="alert alert-danger">
        An error occurred fetching the lists of archetypes.
      </div>
    );
  }

  if (!hasArchetypeFeature) {
    return (
      <div className="mb-3">
        <PremiumEmptyState
          title="Create Reusable Archetypes"
          description="Archetypes are named sets of attributes that help you test your features."
          commercialFeature="archetypes"
          learnMoreLink="https://docs.growthbook.io/features/rules#archetype"
        />
      </div>
    );
  }

  return (
    <>
      <div className="row mb-3">
        <div className="col">
          <h1>Archetypes</h1>
        </div>
        {canCreateGlobal && (
          <div className="col-auto">
            <Button
              onClick={() => {
                setEditArchetype({});
              }}
            >
              Add Archetype
            </Button>
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
                <th>Owner</th>
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
                      {!canCreateGlobal && (
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
              {archetypes.map((archetype: ArchetypeInterface) => {
                const canEdit = permissionsUtil.canUpdateArchetype(
                  archetype,
                  {},
                );
                let parsedAttributes = {};
                try {
                  parsedAttributes = JSON.parse(archetype.attributes);
                } catch {
                  console.error(
                    "Failed to parse attributes. Invalid JSON string: " +
                      archetype.attributes,
                  );
                }
                const canDelete = permissionsUtil.canDeleteArchetype(archetype);
                return (
                  <tr key={archetype.id} className={``}>
                    <td>
                      <Tooltip
                        body={
                          <>
                            <Code
                              code={JSON.stringify(parsedAttributes, null, 2)}
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
                      {archetype?.projects ? (
                        archetype.projects.map((project) => {
                          const pObj = getProjectById(project);
                          if (!pObj) {
                            return null;
                          }
                          return (
                            <div key={pObj.id} className="small">
                              <Link href={`/project/${pObj.id}`}>
                                {pObj.name}
                              </Link>
                            </div>
                          );
                        })
                      ) : (
                        <></>
                      )}
                    </td>
                    <td>{getUserDisplay(archetype.owner)}</td>
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
                );
              })}
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
              source={"archetype-list"}
            />
          )}
        </div>
      </div>
    </>
  );
};
