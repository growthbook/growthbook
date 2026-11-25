import React, { FC, useState } from "react";
import { ArchetypeInterface } from "shared/types/archetype";
import { Trans, useLingui } from "@lingui/react/macro";
import Link from "@/ui/Link";
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
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";

export const ArchetypeList: FC<{
  archetypes: ArchetypeInterface[];
  archetypeErrors: Error | undefined;
  mutate: () => void;
}> = ({ archetypes, archetypeErrors, mutate }) => {
  const { t } = useLingui();
  const [editArchetype, setEditArchetype] =
    useState<Partial<ArchetypeInterface> | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const { project, getProjectById } = useDefinitions();
  const { getOwnerDisplay, hasCommercialFeature } = useUser();

  const hasArchetypeFeature = hasCommercialFeature("archetypes");
  const canCreateGlobal = permissionsUtil.canCreateArchetype({
    projects: [project],
  });
  const { apiCall } = useAuth();

  if (archetypeErrors) {
    return (
      <Callout status="error">
        <Trans>An error occurred fetching the lists of archetypes.</Trans>
      </Callout>
    );
  }

  if (!hasArchetypeFeature) {
    return (
      <div className="mb-3">
        <PremiumEmptyState
          title={t`Create Reusable Archetypes`}
          description={t`Archetypes are named sets of attributes that help you test your features.`}
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
          <h1>
            <Trans>Archetypes</Trans>
          </h1>
        </div>
        {canCreateGlobal && (
          <div className="col-auto">
            <Button
              onClick={() => {
                setEditArchetype({});
              }}
            >
              <Trans>Add Archetype</Trans>
            </Button>
          </div>
        )}
      </div>
      <p className="text-gray mb-3">
        <Trans>
          Archetypes are named sets of attributes that help you test your
          features.
        </Trans>
      </p>
      <div className="mb-3">
        <div className={`mb-3`}>
          <table className="table gbtable appbox ">
            <thead>
              <tr>
                <th>
                  <Trans>Archetype</Trans>
                </th>
                <th>
                  <Trans>Projects</Trans>
                </th>
                <th>
                  <Trans>Environments</Trans>
                </th>
                <th>
                  <Trans>Owner</Trans>
                </th>
                <th>
                  <Trans>Public</Trans>
                </th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {archetypes.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="text-center p-3 ">
                      <Trans>
                        No archetypes created. Click the &ldquo;Add
                        Archetype&rdquo; button to create one.
                      </Trans>
                      {!canCreateGlobal && (
                        <div className="text-muted small">
                          <Trans>
                            (You do not have permissions to create archetypes)
                          </Trans>
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
                    <td>
                      {archetype.environments &&
                      archetype.environments.length > 0 ? (
                        archetype.environments.map((env, i) => (
                          <Badge
                            key={env}
                            label={env}
                            color="gray"
                            ml={i === 0 ? "0" : "2"}
                          />
                        ))
                      ) : (
                        <Badge label={t`All environments`} color="gray" />
                      )}
                    </td>
                    <td>{getOwnerDisplay(archetype.owner)}</td>
                    <td>
                      {archetype.isPublic ? (
                        <span className="text-muted">
                          <Trans>Yes</Trans>
                        </span>
                      ) : (
                        <span className="text-muted">
                          <Trans>No</Trans>
                        </span>
                      )}
                    </td>
                    <td className={styles.showOnHover}>
                      <MoreMenu useRadix={false}>
                        {canEdit ? (
                          <button
                            className="dropdown-item"
                            onClick={() => {
                              setEditArchetype(archetype);
                            }}
                          >
                            <Trans>Edit</Trans>
                          </button>
                        ) : null}
                        {canDelete ? (
                          <DeleteButton
                            useRadix={false}
                            className="dropdown-item"
                            displayName={t`Archetype`}
                            text={t`Delete`}
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
                  ? t`Create Archetype`
                  : t`Edit Archetype`
              }
              source={"archetype-list"}
            />
          )}
        </div>
      </div>
    </>
  );
};
