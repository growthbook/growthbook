import React, { FC, useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { SDKAttribute } from "shared/types/organization";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const AttributeRowMenu: FC<{
  attribute: SDKAttribute;
  onEdit: () => void;
}> = ({ attribute, onEdit }) => {
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
        >
          <BsThreeDotsVertical size={18} />
        </IconButton>
      }
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menuPlacement="end"
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
      <DropdownMenuItem
        onClick={async () => {
          const updatedAttribute: SDKAttribute = {
            property: attribute.property,
            datatype: attribute.datatype,
            archived: !attribute.archived,
          };
          await apiCall<{ res: number }>("/attribute", {
            method: "PUT",
            body: JSON.stringify(updatedAttribute),
          });
          refreshOrganization();
          setMenuOpen(false);
        }}
      >
        {attribute.archived ? "Unarchive" : "Archive"}
      </DropdownMenuItem>
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
              {attribute.datatype} attribute:{" "}
              <code className="font-weight-bold">{attribute.property}</code>?
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
