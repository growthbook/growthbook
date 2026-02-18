import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { recursiveWalk } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FeatureInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { FaQuestionCircle } from "react-icons/fa";
import { BiShow } from "react-icons/bi";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import { useAttributeSchema, useFeaturesList } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AttributeModal from "@/components/Features/AttributeModal";
import ProjectBadges from "@/components/ProjectBadges";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import SortedTags from "@/components/Tags/SortedTags";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import SavedGroupReferencesList from "@/components/SavedGroups/SavedGroupReferencesList";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function AttributeDetailPage() {
  const router = useRouter();
  const property = router.query.property as string | undefined;
  const attributeSchema = useAttributeSchema(true);
  const decodedProperty = useMemo(() => {
    if (!property) return "";
    try {
      return decodeURIComponent(property);
    } catch {
      return property; // Fallback if URL has invalid encoding
    }
  }, [property]);

  const attribute = useMemo(
    () => attributeSchema.find((a) => a.property === decodedProperty),
    [attributeSchema, decodedProperty],
  );

  const { getProjectById, savedGroups } = useDefinitions();
  const { features } = useFeaturesList({ useCurrentProject: false });
  const { experiments } = useExperiments();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showReferencesModal, setShowReferencesModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const {
    referencingFeatures,
    referencingExperiments,
    referencingSavedGroups,
  } = useMemo(() => {
    if (!attribute) {
      return {
        referencingFeatures: [] as FeatureInterface[],
        referencingExperiments: [] as ExperimentInterfaceStringDates[],
        referencingSavedGroups: [] as SavedGroupWithoutValues[],
      };
    }
    const attributeKeys = [attribute.property];
    const attributeFeatureIds: Record<string, Set<string>> = {};
    const attributeExperimentIds: Record<string, Set<string>> = {};
    const attributeGroupIds: Record<string, Set<string>> = {};

    for (const feature of features) {
      for (const envid in feature.environmentSettings) {
        const env = feature.environmentSettings?.[envid];
        env?.rules?.forEach((rule) => {
          try {
            const parsedCondition = JSON.parse(rule?.condition ?? "{}");
            recursiveWalk(parsedCondition, (node) => {
              if (attributeKeys.includes(node[0])) {
                if (!attributeFeatureIds[node[0]])
                  attributeFeatureIds[node[0]] = new Set<string>();
                attributeFeatureIds[node[0]].add(feature.id);
              }
            });
          } catch (e) {
            // ignore
          }
        });
      }
    }

    for (const experiment of experiments) {
      try {
        attributeExperimentIds[experiment.hashAttribute] ??= new Set<string>();
        attributeExperimentIds[experiment.hashAttribute].add(experiment.id);
        const phase = experiment.phases?.[experiment.phases.length - 1];
        const parsedCondition = JSON.parse(phase?.condition ?? "{}");
        recursiveWalk(parsedCondition, (node) => {
          if (attributeKeys.includes(node[0])) {
            if (!attributeExperimentIds[node[0]])
              attributeExperimentIds[node[0]] = new Set<string>();
            attributeExperimentIds[node[0]].add(experiment.id);
          }
        });
      } catch (e) {
        // ignore
      }
    }

    const conditionGroups = savedGroups.filter((g) => g.type === "condition");
    for (const group of conditionGroups) {
      try {
        const parsedCondition = JSON.parse(group?.condition ?? "{}");
        recursiveWalk(parsedCondition, (node) => {
          if (attributeKeys.includes(node[0])) {
            if (!attributeGroupIds[node[0]])
              attributeGroupIds[node[0]] = new Set<string>();
            attributeGroupIds[node[0]].add(group.id);
          }
        });
      } catch (e) {
        // ignore
      }
    }

    const key = attribute.property;
    const referencingFeaturesList = [...(attributeFeatureIds?.[key] ?? [])]
      .map((fid) => features.find((f) => f.id === fid))
      .filter(Boolean) as FeatureInterface[];
    const referencingExperimentsList = [
      ...(attributeExperimentIds?.[key] ?? []),
    ]
      .map((eid) => experiments.find((e) => e.id === eid))
      .filter(Boolean) as ExperimentInterfaceStringDates[];
    const referencingSavedGroupsList = [...(attributeGroupIds?.[key] ?? [])]
      .map((gid) => savedGroups.find((g) => g.id === gid))
      .filter(Boolean) as SavedGroupWithoutValues[];

    return {
      referencingFeatures: referencingFeaturesList,
      referencingExperiments: referencingExperimentsList,
      referencingSavedGroups: referencingSavedGroupsList,
    };
  }, [attribute, features, experiments, savedGroups]);

  const totalReferences =
    referencingFeatures.length +
    referencingExperiments.length +
    referencingSavedGroups.length;

  if (property === undefined) {
    return null; // Still loading router
  }

  if (!attribute) {
    return (
      <>
        <PageHead
          breadcrumb={[
            { display: "Attributes", href: "/attributes" },
            { display: decodedProperty },
          ]}
        />
        <div className="p-3 container-fluid pagecontents">
          <Callout status="error">
            Attribute &quot;{decodedProperty}&quot; not found. It may have been
            deleted or you may not have access.{" "}
            <Link href="/attributes">Back to Attributes</Link>
          </Callout>
        </div>
      </>
    );
  }

  const canEdit = permissionsUtil.canCreateAttribute(attribute);

  return (
    <>
      {showReferencesModal && (
        <Modal
          open={true}
          header={`References: ${attribute.property}`}
          close={() => setShowReferencesModal(false)}
          size="max"
          closeCta="Close"
        >
          <SavedGroupReferencesList
            features={referencingFeatures}
            experiments={referencingExperiments}
            savedGroups={referencingSavedGroups}
          />
        </Modal>
      )}
      {showEditModal && (
        <AttributeModal
          close={() => {
            setShowEditModal(false);
            refreshOrganization();
          }}
          attribute={attribute.property}
        />
      )}
      {showDeleteModal && (
        <Modal
          open={true}
          header="Delete Attribute"
          close={() => setShowDeleteModal(false)}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            await apiCall<{ status: number }>("/attribute/", {
              method: "DELETE",
              body: JSON.stringify({ id: attribute.property }),
            });
            refreshOrganization();
            setShowDeleteModal(false);
            router.push("/attributes");
          }}
        >
          <p>
            Are you sure you want to delete the{" "}
            {attribute.hashAttribute ? "identifier " : ""}
            {attribute.datatype} attribute:{" "}
            <code className="font-weight-bold">{attribute.property}</code>?
          </p>
          <p>This action cannot be undone.</p>
        </Modal>
      )}
      <PageHead
        breadcrumb={[
          { display: "Attributes", href: "/attributes" },
          { display: attribute.property },
        ]}
      />
      <div className="p-3 container-fluid pagecontents">
        <Flex align="center" justify="between" mb="4">
          <Heading as="h1" size="2x-large">
            {attribute.property}
          </Heading>
          {canEdit && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="3"
                  highContrast
                >
                  <BsThreeDotsVertical size={18} />
                </IconButton>
              }
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
              menuPlacement="end"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setShowEditModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  Edit Information
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  color="red"
                  onClick={() => {
                    setShowDeleteModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenu>
          )}
        </Flex>

        <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
          <Flex align="center" gap="4" wrap="wrap">
            <Text>
              Data type: <strong>{attribute.datatype}</strong>
              {attribute.datatype === "enum" && attribute.enum && (
                <> ({attribute.enum})</>
              )}
            </Text>
            {attribute.format && (
              <Text>
                Format: <strong>{attribute.format}</strong>
              </Text>
            )}
            {getProjectById && (attribute.projects?.length ?? 0) > 0 && (
              <Flex align="center" gap="2">
                <Text>Projects:</Text>
                <ProjectBadges
                  projectIds={attribute.projects ?? []}
                  resourceType="attribute"
                />
              </Flex>
            )}
            {(attribute.tags?.length ?? 0) > 0 && (
              <Flex align="center" gap="2">
                <Text>Tags:</Text>
                <SortedTags tags={attribute.tags ?? []} useFlex={true} />
              </Flex>
            )}
            <Text>
              Identifier:{" "}
              <strong>{attribute.hashAttribute ? "Yes" : "No"}</strong>
              {attribute.hashAttribute && (
                <Tooltip body="Any attribute that uniquely identifies a user, account, device, or similar.">
                  <FaQuestionCircle
                    className="ml-1"
                    style={{ position: "relative", top: "-1px" }}
                  />
                </Tooltip>
              )}
            </Text>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            {totalReferences > 0 ? (
              <Link onClick={() => setShowReferencesModal(true)}>
                <BiShow /> {totalReferences} reference
                {totalReferences !== 1 && "s"}
              </Link>
            ) : (
              <Tooltip content="No features, experiments, or saved groups currently reference this attribute.">
                <span
                  style={{ color: "var(--gray-10)", cursor: "not-allowed" }}
                >
                  <BiShow /> {totalReferences} references
                </span>
              </Tooltip>
            )}
          </Flex>
        </Flex>

        {attribute.archived && (
          <Callout status="info" mb="4">
            <strong>This attribute is archived.</strong> It will not be
            available when creating or editing targeting rules.
          </Callout>
        )}

        <Box mb="4">
          <Frame>
            <div className="mh-350px" style={{ overflowY: "auto" }}>
              <MarkdownInlineEdit
                value={attribute.description || ""}
                save={async (description) => {
                  const payload = { ...attribute, description };
                  // Backend expects specific types or omitted, not null
                  if (payload.archived === null) delete payload.archived;
                  if (payload.hashAttribute === null)
                    delete payload.hashAttribute;
                  if (payload.tags === null) delete payload.tags;
                  if (payload.projects === null) delete payload.projects;
                  if (payload.format === null) delete payload.format;
                  if (payload.enum === null) delete payload.enum;
                  await apiCall("/attribute", {
                    method: "PUT",
                    body: JSON.stringify(payload),
                  });
                  await refreshOrganization();
                }}
                canCreate={canEdit}
                canEdit={canEdit}
                label="description"
                header="Description"
                headerClassName="h4"
                containerClassName="mb-1"
              />
            </div>
          </Frame>
        </Box>

        <hr />
      </div>
    </>
  );
}
