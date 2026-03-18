import React, { FC, useState } from "react";
import { ArchetypeInterface } from "shared/types/archetype";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
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
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

export const ArchetypeList: FC<{
  archetypes: ArchetypeInterface[];
  archetypeErrors: Error | undefined;
  mutate: () => void;
}> = ({ archetypes, archetypeErrors, mutate }) => {
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
      <Callout status="error" mb="3">
        An error occurred fetching the lists of archetypes.
      </Callout>
    );
  }

  if (!hasArchetypeFeature) {
    return (
      <Box mb="3">
        <PremiumEmptyState
          title="Create Reusable Archetypes"
          description="Archetypes are named sets of attributes that help you test your features."
          commercialFeature="archetypes"
          learnMoreLink="https://docs.growthbook.io/features/rules#archetype"
        />
      </Box>
    );
  }

  return (
    <>
      <Flex align="center" justify="between" mb="3" gap="3" wrap="wrap">
        <Heading as="h1" size="2x-large">
          Archetypes
        </Heading>
        {canCreateGlobal ? (
          <Button
            onClick={() => {
              setEditArchetype({});
            }}
          >
            Add Archetype
          </Button>
        ) : null}
      </Flex>
      <Box mb="3" style={{ color: "var(--gray-11)" }}>
        <p style={{ margin: 0 }}>
          Archetypes are named sets of attributes that help you test your
          features.
        </p>
      </Box>
      <Box mb="3">
        <Table variant="list" stickyHeader={false} roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Archetype</TableColumnHeader>
              <TableColumnHeader>Projects</TableColumnHeader>
              <TableColumnHeader>Owner</TableColumnHeader>
              <TableColumnHeader>Public</TableColumnHeader>
              <TableColumnHeader style={{ width: 40 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {archetypes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Box py="3" style={{ textAlign: "center" }}>
                    No archetypes created. Click the &ldquo;Add Archetype&rdquo;
                    button to create one.
                    {!canCreateGlobal && (
                      <Box
                        mt="2"
                        className="text-muted"
                        style={{ fontSize: "var(--font-size-2)" }}
                      >
                        (You do not have permissions to create archetypes)
                      </Box>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ) : null}
            {archetypes.map((archetype: ArchetypeInterface) => {
              const canEdit = permissionsUtil.canUpdateArchetype(archetype, {});
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
                <TableRow key={archetype.id}>
                  <TableCell>
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
                          <span
                            className="text-muted"
                            style={{ fontSize: "var(--font-size-2)" }}
                          >
                            {archetype.description}
                          </span>
                        </>
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {archetype?.projects
                      ? archetype.projects.map((projId) => {
                          const pObj = getProjectById(projId);
                          if (!pObj) {
                            return null;
                          }
                          return (
                            <Box
                              key={pObj.id}
                              style={{ fontSize: "var(--font-size-2)" }}
                            >
                              <Link href={`/project/${pObj.id}`}>
                                {pObj.name}
                              </Link>
                            </Box>
                          );
                        })
                      : null}
                  </TableCell>
                  <TableCell>{getOwnerDisplay(archetype.owner)}</TableCell>
                  <TableCell>
                    {archetype.isPublic ? (
                      <span className="text-muted">Yes</span>
                    ) : (
                      <span className="text-muted">No</span>
                    )}
                  </TableCell>
                  <TableCell className={styles.showOnHover}>
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
      </Box>
    </>
  );
};
