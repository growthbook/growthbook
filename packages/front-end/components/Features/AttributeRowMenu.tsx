import React, { FC, useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { PiDotsThreeVertical } from "react-icons/pi";
import { SDKAttribute } from "shared/types/organization";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { syncsIdentifiersAutomatically } from "@/components/Features/IdentifierModal";
import { IDENTIFIER_DATA_TYPES } from "@/components/Features/AttributeFormLayout";

// Managed Warehouse and Event Forwarder Data Sources only build identifier
// types from active identifiers, so archiving or converting one drops it there.
function AutoSyncedIdentifierWarning({
  attribute,
  undo,
}: {
  attribute: SDKAttribute;
  undo: "convert" | "unarchive";
}) {
  const { i18n } = useLingui();
  const { datasources } = useDefinitions();
  const affected = datasources.filter(syncsIdentifiersAutomatically);
  if (!attribute.hashAttribute || affected.length === 0) return null;
  const datasourceNames = new Intl.ListFormat(i18n.locale).format(
    affected.map((d) => d.name),
  );
  const property = attribute.property;
  return (
    <Callout status="warning" mt="3">
      {undo === "convert" ? (
        <Trans>
          {datasourceNames} will stop using <code>{property}</code> as an
          identifier type, so experiments assigned on it can&apos;t be analyzed
          there until you convert it back.
        </Trans>
      ) : (
        <Trans>
          {datasourceNames} will stop using <code>{property}</code> as an
          identifier type, so experiments assigned on it can&apos;t be analyzed
          there until you unarchive it.
        </Trans>
      )}
    </Callout>
  );
}

export function ConvertToAttributeItem({
  attribute,
}: {
  attribute: SDKAttribute;
}) {
  const { t } = useLingui();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const property = attribute.property;
  return (
    <DropdownMenuItem
      confirmation={{
        submit: async () => {
          await apiCall<{ status: number }>("/attribute", {
            method: "PUT",
            body: JSON.stringify({
              property: attribute.property,
              datatype: attribute.datatype,
              hashAttribute: false,
            }),
          });
          refreshOrganization();
        },
        confirmationTitle: t`Convert to Attribute`,
        cta: t`Convert`,
        ctaColor: "violet",
        getConfirmationContent: async () => (
          <>
            <Trans>
              <code>{property}</code> will no longer be offered for assigning
              users in new experiments and percentage rollouts. Experiments and
              rules that already use it will continue working, and it stays
              available for targeting.
            </Trans>
            <AutoSyncedIdentifierWarning attribute={attribute} undo="convert" />
          </>
        ),
      }}
    >
      <Trans>Convert to Attribute</Trans>
    </DropdownMenuItem>
  );
}

// Unarchiving needs no confirmation since it only makes the attribute
// selectable again.
export function ArchiveAttributeItem({
  attribute,
  onDone,
}: {
  attribute: SDKAttribute;
  onDone: () => void;
}) {
  const { t } = useLingui();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const setArchived = async (archived: boolean) => {
    const updatedAttribute: SDKAttribute = {
      property: attribute.property,
      datatype: attribute.datatype,
      archived,
    };
    await apiCall<{ res: number }>("/attribute", {
      method: "PUT",
      body: JSON.stringify(updatedAttribute),
    });
    refreshOrganization();
    onDone();
  };

  if (attribute.archived) {
    return (
      <DropdownMenuItem onClick={() => setArchived(false)}>
        <Trans>Unarchive</Trans>
      </DropdownMenuItem>
    );
  }
  const property = attribute.property;
  return (
    <DropdownMenuItem
      confirmation={{
        submit: () => setArchived(true),
        confirmationTitle: attribute.hashAttribute
          ? t`Archive Identifier`
          : t`Archive Attribute`,
        cta: t`Archive`,
        ctaColor: "violet",
        getConfirmationContent: async () => (
          <>
            {attribute.hashAttribute ? (
              <Trans>
                <code>{property}</code> will be hidden when creating or editing
                experiments and targeting rules. Experiments and rules that
                already use it will continue working, and you can unarchive it
                any time.
              </Trans>
            ) : (
              <Trans>
                <code>{property}</code> will be hidden when creating or editing
                targeting rules. Rules that already use it will continue
                working, and you can unarchive it any time.
              </Trans>
            )}
            <AutoSyncedIdentifierWarning
              attribute={attribute}
              undo="unarchive"
            />
          </>
        ),
      }}
    >
      <Trans>Archive</Trans>
    </DropdownMenuItem>
  );
}

const AttributeRowMenu: FC<{
  attribute: SDKAttribute;
  onEdit: () => void;
  onConvertToIdentifier?: () => void;
}> = ({ attribute, onEdit, onConvertToIdentifier }) => {
  const { t } = useLingui();
  const [menuOpen, setMenuOpen] = useState(false);
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();

  if (!permissionsUtil.canCreateAttribute(attribute)) return null;

  const property = attribute.property;
  const datatype = attribute.datatype;

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          aria-label={t`Actions for attribute ${property}`}
        >
          <PiDotsThreeVertical size={18} />
        </IconButton>
      }
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menuPlacement="end"
      variant="soft"
    >
      {!attribute.archived && (
        <DropdownMenuItem
          onClick={() => {
            onEdit();
            setMenuOpen(false);
          }}
        >
          <Trans>Edit</Trans>
        </DropdownMenuItem>
      )}
      {!attribute.archived &&
        !attribute.hashAttribute &&
        onConvertToIdentifier &&
        IDENTIFIER_DATA_TYPES.includes(attribute.datatype) && (
          <DropdownMenuItem
            onClick={() => {
              onConvertToIdentifier();
              setMenuOpen(false);
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
        onDone={() => setMenuOpen(false)}
      />
      <DropdownMenuSeparator />
      <DropdownMenuItem
        color="red"
        confirmation={{
          submit: async () => {
            await apiCall<{ status: number }>("/attribute/", {
              method: "DELETE",
              body: JSON.stringify({ id: attribute.property }),
            });
            refreshOrganization();
          },
          confirmationTitle: t`Delete Attribute`,
          cta: t`Delete`,
          ctaColor: "red",
          getConfirmationContent: async () => (
            <>
              {attribute.hashAttribute ? (
                <Trans>
                  Are you sure you want to delete the identifier {datatype}{" "}
                  attribute: <code>{property}</code>?
                </Trans>
              ) : (
                <Trans>
                  Are you sure you want to delete the {datatype} attribute:{" "}
                  <code>{property}</code>?
                </Trans>
              )}
              <br />
              <Trans>This action cannot be undone.</Trans>
            </>
          ),
        }}
      >
        <Trans>Delete</Trans>
      </DropdownMenuItem>
    </DropdownMenu>
  );
};

export default AttributeRowMenu;
