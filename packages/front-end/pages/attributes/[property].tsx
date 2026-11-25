import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaQuestionCircle } from "react-icons/fa";
import { Trans, useLingui } from "@lingui/react/macro";
import ReferencesLink from "@/components/References/ReferencesLink";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import { useAttributeSchema } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useAttributeReferences } from "@/hooks/useAttributeReferences";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AttributeModal from "@/components/Features/AttributeModal";
import IdentifierModal from "@/components/Features/IdentifierModal";
import ProjectBadges from "@/components/ProjectBadges";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import DataList from "@/ui/DataList";
import { useCustomFields } from "@/hooks/useCustomFields";
import { filterCustomFieldsForSectionAndProjects } from "@/services/customFields";
import { customFieldDataListItems } from "@/components/CustomFields/renderCustomFieldValue";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import SortedTags from "@/components/Tags/SortedTags";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import AttributeReferencesList from "@/components/Features/AttributeReferencesList";
import {
  ArchiveAttributeItem,
  ConvertToAttributeItem,
} from "@/components/Features/AttributeRowMenu";
import { IDENTIFIER_DATA_TYPES } from "@/components/Features/AttributeFormLayout";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function AttributeDetailPage() {
  const { t } = useLingui();
  const router = useRouter();
  const property = router.query.property as string | undefined;
  const attributeSchema = useAttributeSchema(true);
  const attribute = useMemo(
    () => attributeSchema.find((a) => a.property === property),
    [attributeSchema, property],
  );

  const {
    references,
    loading: referencesLoading,
    error: referencesError,
  } = useAttributeReferences(property ? [property] : []);
  const { apiCall } = useAuth();
  const { refreshOrganization, hasCommercialFeature } = useUser();
  const allCustomFields = useCustomFields();
  const attributeCustomFields = useMemo(
    () =>
      hasCommercialFeature("custom-metadata")
        ? (filterCustomFieldsForSectionAndProjects(
            allCustomFields,
            "attribute",
            attribute?.projects,
          ) ?? [])
        : [],
    [allCustomFields, hasCommercialFeature, attribute?.projects],
  );
  const permissionsUtil = usePermissionsUtil();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showReferencesModal, setShowReferencesModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const attributeReferences = property ? references?.[property] : undefined;
  const referencingFeatures = attributeReferences?.features ?? [];
  const referencingExperiments = attributeReferences?.experiments ?? [];
  const referencingSavedGroups = attributeReferences?.savedGroups ?? [];

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
            { display: t`Attributes`, href: "/attributes" },
            { display: property },
          ]}
        />
        <div className="container-fluid pagecontents">
          <Callout status="error">
            <Trans>
              Attribute &quot;{property}&quot; not found. It may have been
              deleted or you may not have access.{" "}
              <Link href="/attributes">Back to Attributes</Link>
            </Trans>
          </Callout>
        </div>
      </>
    );
  }

  const canEdit = permissionsUtil.canCreateAttribute(attribute);
  const attributeProperty = attribute.property;
  const datatype = attribute.datatype;
  const format = attribute.format;

  return (
    <>
      {showReferencesModal && (
        <Modal
          open={true}
          header={t`References: ${attributeProperty}`}
          close={() => setShowReferencesModal(false)}
          closeCta={t`Close`}
          trackingEventModalType="show-attribute-references"
        >
          <AttributeReferencesList
            features={referencingFeatures}
            experiments={referencingExperiments}
            conditionGroups={referencingSavedGroups}
          />
        </Modal>
      )}
      {showEditModal &&
        (attribute.hashAttribute ? (
          <IdentifierModal
            source="attribute-page"
            existing={attribute}
            close={() => setShowEditModal(false)}
            onSave={(saved) => {
              if (saved !== attribute.property) {
                router.replace(`/attributes/${encodeURIComponent(saved)}`);
              }
            }}
          />
        ) : (
          <AttributeModal
            close={() => {
              setShowEditModal(false);
              refreshOrganization();
            }}
            attribute={attribute.property}
            onSave={(saved) => {
              if (saved !== attribute.property) {
                router.replace(`/attributes/${encodeURIComponent(saved)}`);
              }
            }}
          />
        ))}
      {showConvertModal && (
        <IdentifierModal
          source="attribute-page"
          existing={attribute}
          close={() => setShowConvertModal(false)}
          onSave={(saved) => {
            if (saved !== attribute.property) {
              router.replace(`/attributes/${encodeURIComponent(saved)}`);
            }
          }}
        />
      )}
      {showDeleteModal && (
        <Modal
          open={true}
          header={t`Delete Attribute`}
          close={() => setShowDeleteModal(false)}
          cta={t`Delete`}
          submitColor="danger"
          trackingEventModalType=""
          submit={async () => {
            const response = await apiCall<{
              status: number;
              eventForwarderWarning?: string;
            }>("/attribute/", {
              method: "DELETE",
              body: JSON.stringify({ id: attribute.property }),
            });
            refreshOrganization();
            setShowDeleteModal(false);
            if (response.eventForwarderWarning) {
              sessionStorage.setItem(
                "attributeDeleteEventForwarderWarning",
                response.eventForwarderWarning,
              );
            }
            router.push("/attributes");
          }}
        >
          <p>
            {attribute.hashAttribute ? (
              <Trans>
                Are you sure you want to delete the identifier {datatype}{" "}
                attribute:{" "}
                <code className="font-weight-bold">{attributeProperty}</code>?
              </Trans>
            ) : (
              <Trans>
                Are you sure you want to delete the {datatype} attribute:{" "}
                <code className="font-weight-bold">{attributeProperty}</code>?
              </Trans>
            )}
          </p>
          <p>
            <Trans>This action cannot be undone.</Trans>
          </p>
        </Modal>
      )}
      <PageHead
        breadcrumb={[
          { display: t`Attributes`, href: "/attributes" },
          { display: attribute.property },
        ]}
      />
      <div className="container-fluid pagecontents">
        <Flex align="center" justify="between" mb="4">
          <Heading as="h1" size="xl" overflowWrap="anywhere">
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
                  <Trans>Edit Information</Trans>
                </DropdownMenuItem>
                {!attribute.archived &&
                  !attribute.hashAttribute &&
                  IDENTIFIER_DATA_TYPES.includes(attribute.datatype) && (
                    <DropdownMenuItem
                      onClick={() => {
                        setShowConvertModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      <Trans>Convert to Identifier</Trans>
                    </DropdownMenuItem>
                  )}
                {!attribute.archived && attribute.hashAttribute && (
                  <ConvertToAttributeItem attribute={attribute} />
                )}
                <ArchiveAttributeItem
                  attribute={attribute}
                  onDone={() => setDropdownOpen(false)}
                />
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
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenu>
          )}
        </Flex>

        <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
          <Flex align="center" gap="4" wrap="wrap">
            <Text>
              <Trans>
                Data type: <strong>{datatype}</strong>
              </Trans>
              {attribute.datatype === "enum" && attribute.enum && (
                <> ({attribute.enum})</>
              )}
            </Text>
            {format && (
              <Text>
                <Trans>
                  Format: <strong>{format}</strong>
                </Trans>
              </Text>
            )}
            {(attribute.projects?.length ?? 0) > 0 && (
              <Flex align="center" gap="2">
                <Text>
                  <Trans>Projects:</Trans>
                </Text>
                <ProjectBadges
                  projectIds={attribute.projects ?? []}
                  resourceType="attribute"
                />
              </Flex>
            )}
            {(attribute.tags?.length ?? 0) > 0 && (
              <Flex align="center" gap="2">
                <Text>
                  <Trans>Tags:</Trans>
                </Text>
                <SortedTags tags={attribute.tags ?? []} useFlex={true} />
              </Flex>
            )}
            <Text>
              <Trans>Identifier:</Trans>{" "}
              <strong>
                {attribute.hashAttribute ? (
                  <Trans>Yes</Trans>
                ) : (
                  <Trans>No</Trans>
                )}
              </strong>
              {attribute.hashAttribute && (
                <Tooltip
                  body={t`Any attribute that uniquely identifies a user, account, device, or similar.`}
                >
                  <FaQuestionCircle
                    className="ml-1"
                    style={{ position: "relative", top: "-1px" }}
                  />
                </Tooltip>
              )}
            </Text>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            <ReferencesLink
              total={totalReferences}
              onShow={() => setShowReferencesModal(true)}
              emptyTooltip={t`No features, experiments, or saved groups currently reference this attribute.`}
              status={
                referencesError
                  ? "error"
                  : referencesLoading
                    ? "loading"
                    : undefined
              }
            />
          </Flex>
        </Flex>

        {attribute.archived && (
          <Callout status="info" mb="4">
            <Trans>
              <strong>This attribute is archived.</strong> It will not be
              available when creating or editing targeting rules.
            </Trans>
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
                  if (payload.disableEqualityConditions === null)
                    delete payload.disableEqualityConditions;
                  if (payload.customFields === null)
                    delete payload.customFields;
                  await apiCall("/attribute", {
                    method: "PUT",
                    body: JSON.stringify(payload),
                  });
                  await refreshOrganization();
                }}
                canCreate={canEdit}
                canEdit={canEdit}
                label="description"
                header={t`Description`}
                headerClassName="h4"
                containerClassName="mb-1"
              />
            </div>
          </Frame>
        </Box>

        {attributeCustomFields.length > 0 && (
          <Box mb="4">
            <Frame>
              <Heading as="h4" size="sm" mb="3">
                <Trans>Additional Fields</Trans>
              </Heading>
              <DataList
                data={customFieldDataListItems(
                  attributeCustomFields,
                  attribute.customFields,
                )}
                maxColumns={3}
              />
            </Frame>
          </Box>
        )}
      </div>
    </>
  );
}
