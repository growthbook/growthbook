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
  /** Keeps Enable/Disable visible but inert, with this as the explanation. */
  toggleLockedReason?: string;
  onShowAuditLog?: (key: ApiKeyInterface) => void;
  onCopy?: (key: ApiKeyInterface) => void;
}

export default function ApiKeyRowMenu({
  apiKey,
  canDeleteKeys,
  onDelete,
  onEdit,
  onToggleClick,
  toggleLockedReason,
  onShowAuditLog,
  onCopy,
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
        {/* The auto-created visual editor key is managed by the app, not the user */}
        {onEdit &&
          apiKey.secret &&
          !(apiKey.role === "visualEditor" && !apiKey.scoped) && (
            <DropdownMenuItem onClick={() => onEdit(apiKey)}>
              Edit key
            </DropdownMenuItem>
          )}
        {onCopy && (
          <DropdownMenuItem onClick={() => onCopy(apiKey)}>
            Copy settings to new key
          </DropdownMenuItem>
        )}
        {onToggleClick && (
          <DropdownMenuItem
            disabled={!!toggleLockedReason}
            tooltip={toggleLockedReason}
            onClick={() => onToggleClick(apiKey)}
          >
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
