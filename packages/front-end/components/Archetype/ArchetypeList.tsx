import React, { FC, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ArchetypeInterface } from "shared/types/archetype";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  RowMenuTrigger,
} from "@/ui/DropdownMenu";

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
      <Callout status="error">
        An error occurred fetching the lists of archetypes.
      </Callout>
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
          <Table variant="list" stickyHeader={false} roundedCorners>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Archetype</TableColumnHeader>
                <TableColumnHeader>Projects</TableColumnHeader>
                <TableColumnHeader>Environments</TableColumnHeader>
                <TableColumnHeader>Owner</TableColumnHeader>
                <TableColumnHeader>Public</TableColumnHeader>
                <TableColumnHeader style={{ width: 46 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {archetypes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} justify="center">
                    No archetypes created. Click the &ldquo;Add Archetype&rdquo;
                    button to create one.
                    {!canCreateGlobal && (
                      <Text as="div" size="sm" color="text-mid">
                        (You do not have permissions to create archetypes)
                      </Text>
                    )}
                  </TableCell>
                </TableRow>
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
                  <TableRow key={archetype.id} align="start">
                    <TableCell>
                      <Tooltip
                        body={
                          <Code
                            code={JSON.stringify(parsedAttributes, null, 2)}
                            language="json"
                          />
                        }
                      >
                        {archetype.name}
                        {archetype.description && (
                          <Text as="div" size="sm" color="text-mid">
                            {archetype.description}
                          </Text>
                        )}
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Flex direction="column">
                        {(archetype.projects ?? []).map((id) => {
                          const pObj = getProjectById(id);
                          return pObj ? (
                            <Link key={pObj.id} href={`/project/${pObj.id}`}>
                              {pObj.name}
                            </Link>
                          ) : null;
                        })}
                      </Flex>
                    </TableCell>
                    <TableCell>
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
                        <Badge label="All environments" color="gray" />
                      )}
                    </TableCell>
                    <TableCell>{getOwnerDisplay(archetype.owner)}</TableCell>
                    <TableCell>{archetype.isPublic ? "Yes" : "No"}</TableCell>
                    <TableCell justify="end">
                      {canEdit || canDelete ? (
                        <DropdownMenu
                          trigger={
                            <RowMenuTrigger
                              label={`Actions for ${archetype.name}`}
                            />
                          }
                          menuPlacement="end"
                          variant="soft"
                        >
                          <DropdownMenuGroup>
                            {canEdit && (
                              <DropdownMenuItem
                                onClick={() => setEditArchetype(archetype)}
                              >
                                Edit
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                color="red"
                                confirmation={{
                                  submit: async () => {
                                    await apiCall(
                                      `/archetype/${archetype.id}`,
                                      { method: "DELETE" },
                                    );
                                    await mutate();
                                  },
                                  confirmationTitle: "Delete Archetype",
                                  cta: "Delete",
                                  getConfirmationContent: async () =>
                                    "Are you sure? This action cannot be undone.",
                                }}
                              >
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                        </DropdownMenu>
                      ) : null}
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
        </div>
      </div>
    </>
  );
};
