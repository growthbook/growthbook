import React, { FC, useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { PiDotsThreeVertical } from "react-icons/pi";
import { SDKAttribute } from "shared/types/organization";
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
}: {
  attribute: SDKAttribute;
}) {
  const { datasources } = useDefinitions();
  if (
    !attribute.hashAttribute ||
    !datasources.some(syncsIdentifiersAutomatically)
  ) {
    return null;
  }
  return (
    <Callout status="warning" mt="3">
      Your Managed Warehouse and Event Forwarder Data Sources will also stop
      using it as an identifier type, so experiments assigned on it can&apos;t
      be analyzed there.
    </Callout>
  );
}

export function ConvertToAttributeItem({
  attribute,
}: {
  attribute: SDKAttribute;
}) {
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
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
        confirmationTitle: "Convert to Attribute",
        cta: "Convert",
        ctaColor: "violet",
        getConfirmationContent: async () => (
          <>
            <code>{attribute.property}</code> will no longer be offered for
            assigning users in new experiments and percentage rollouts. Ones
            already using it keep working in your SDKs, and it stays available
            for targeting.
            <AutoSyncedIdentifierWarning attribute={attribute} />
          </>
        ),
      }}
    >
      Convert to Attribute
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
        Unarchive
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      confirmation={{
        submit: () => setArchived(true),
        confirmationTitle: attribute.hashAttribute
          ? "Archive Identifier"
          : "Archive Attribute",
        cta: "Archive",
        ctaColor: "violet",
        getConfirmationContent: async () => (
          <>
            <code>{attribute.property}</code> will no longer be offered when
            creating or editing{" "}
            {attribute.hashAttribute
              ? "experiments and targeting rules"
              : "targeting rules"}
            . Anything already using it keeps working in your SDKs, which still
            receive it. You can unarchive it at any time.
            <AutoSyncedIdentifierWarning attribute={attribute} />
          </>
        ),
      }}
    >
      Archive
    </DropdownMenuItem>
  );
}

const AttributeRowMenu: FC<{
  attribute: SDKAttribute;
  onEdit: () => void;
  onConvertToIdentifier?: () => void;
}> = ({ attribute, onEdit, onConvertToIdentifier }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();

  if (!permissionsUtil.canCreateAttribute(attribute)) return null;

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          aria-label={`Actions for attribute ${attribute.property}`}
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
          Edit
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
            Convert to Identifier
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
          confirmationTitle: "Delete Attribute",
          cta: "Delete",
          ctaColor: "red",
          getConfirmationContent: async () => (
            <>
              Are you sure you want to delete the{" "}
              {attribute.hashAttribute ? "identifier " : ""}
              {attribute.datatype} attribute: <code>{attribute.property}</code>?
              <br />
              This action cannot be undone.
            </>
          ),
        }}
      >
        Delete
      </DropdownMenuItem>
    </DropdownMenu>
  );
};

export default AttributeRowMenu;
