import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";

interface ApiKeyRowMenuProps {
  apiKey: ApiKeyInterface;
  canDeleteKeys: boolean;
  onDelete: (keyId: string | undefined) => () => Promise<void>;
  onEdit?: (key: ApiKeyInterface) => void;
  onToggleClick?: (key: ApiKeyInterface) => void;
  onShowAuditLog?: (key: ApiKeyInterface) => void;
}

export default function ApiKeyRowMenu({
  apiKey,
  canDeleteKeys,
  onDelete,
  onEdit,
  onToggleClick,
  onShowAuditLog,
}: ApiKeyRowMenuProps) {
  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          aria-label="API key actions"
        >
          <BsThreeDotsVertical size={18} />
        </IconButton>
      }
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        {/* Only org secret keys (not PATs) can be edited in place */}
        {onEdit && apiKey.secret && !apiKey.userId && (
          <DropdownMenuItem onClick={() => onEdit(apiKey)}>
            Edit permissions & description
          </DropdownMenuItem>
        )}
        {onToggleClick && (
          <DropdownMenuItem onClick={() => onToggleClick(apiKey)}>
            {apiKey.disabled ? "Enable key" : "Disable key"}
          </DropdownMenuItem>
        )}
        {onShowAuditLog && (
          <DropdownMenuItem onClick={() => onShowAuditLog(apiKey)}>
            Audit log
          </DropdownMenuItem>
        )}
        {canDeleteKeys && (
          <DropdownMenuItem
            color="red"
            confirmation={{
              submit: onDelete(apiKey.id),
              confirmationTitle: "Delete API Key",
              cta: "Delete",
            }}
          >
            Delete key
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}
