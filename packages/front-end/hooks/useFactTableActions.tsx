import { useState } from "react";
import { useRouter } from "next/router";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FactTableInterface } from "shared/types/fact-table";
import { DEFAULT_TOP_VALUES_LOOKBACK_VALUE } from "shared/settings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getAutoSliceUpdateFrequencyText } from "@/services/env";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { FactTablePageData } from "@/hooks/useFactTableDetailsPage";
import NewFactTableModal from "@/components/FactTables/NewFactTableModal";
import AggregatedFactTableSettingsModal from "@/components/FactTables/AggregatedFactTableSettingsModal";
import OfficialResourceModal from "@/components/OfficialResourceModal";
import HistoryTable from "@/components/HistoryTable";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";

type Dialog = "settings" | "sql" | "official" | "aggregated" | "audit" | null;

// The one action menu for a fact table page, with the modals it opens. Pages
// render `menu` and `modals`, and can open the SQL editor from elsewhere.
export default function useFactTableActions(page: FactTablePageData) {
  const { factTable } = page;
  const router = useRouter();
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const topValuesLookbackDays =
    useOrgSettings().topValuesLookbackValue ??
    DEFAULT_TOP_VALUES_LOOKBACK_VALUE;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [duplicate, setDuplicate] = useState<FactTableInterface | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setDialog(null);
  const open = (d: Dialog) => {
    setDialog(d);
    setMenuOpen(false);
  };

  const canToggleAutoSlices =
    page.canEdit &&
    hasCommercialFeature("metric-slices") &&
    factTable.columns.some((c) => c.isAutoSliceColumn && !c.deleted);

  const modals = (
    <>
      {dialog === "settings" || dialog === "sql" ? (
        <NewFactTableModal
          close={close}
          existing={factTable}
          editSql={dialog === "sql"}
        />
      ) : null}
      {duplicate ? (
        <NewFactTableModal
          close={() => setDuplicate(null)}
          existing={duplicate}
          duplicate
        />
      ) : null}
      {dialog === "aggregated" ? (
        <AggregatedFactTableSettingsModal factTable={factTable} close={close} />
      ) : null}
      {dialog === "official" ? (
        <OfficialResourceModal
          close={close}
          resourceType="Fact Table"
          onSubmit={async () => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({ managedBy: "admin" }),
            });
            await mutateDefinitions();
          }}
          source="fact-table-page"
        />
      ) : null}
      {dialog === "audit" ? (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={close}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="factTable" id={factTable.id} />
        </ModalStandard>
      ) : null}
    </>
  );

  const menu = (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          aria-label="More actions"
        >
          <BsThreeDotsVertical size={16} />
        </IconButton>
      }
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menuPlacement="end"
    >
      <DropdownMenuGroup>
        {page.canEdit && (
          <DropdownMenuItem onClick={() => open("settings")}>
            Edit settings
          </DropdownMenuItem>
        )}
        {page.canEdit && (
          <DropdownMenuItem onClick={() => open("sql")}>
            Edit SQL
          </DropdownMenuItem>
        )}
        {!factTable.managedBy && page.canManageOfficial && (
          <DropdownMenuItem onClick={() => open("official")}>
            Convert to Official Fact Table
          </DropdownMenuItem>
        )}
        {factTable.managedBy === "admin" && page.canManageOfficial && (
          <DropdownMenuItem
            confirmation={{
              confirmationTitle: "Remove official status",
              cta: "Remove",
              getConfirmationContent: async () =>
                "Anyone with edit access will be able to change this Fact Table.",
              submit: async () => {
                await apiCall(`/fact-tables/${factTable.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ managedBy: "" }),
                });
                mutateDefinitions();
              },
              closeDropdown: () => setMenuOpen(false),
            }}
          >
            Remove official status
          </DropdownMenuItem>
        )}
        {canToggleAutoSlices && (
          <DropdownMenuItem
            tooltip={`Updates Auto Slice levels every ${getAutoSliceUpdateFrequencyText()} from the top values over the last ${topValuesLookbackDays} days. Locked levels are kept.`}
            onClick={async (e) => {
              // Stays open to show a failed save
              e.preventDefault();
              await apiCall(`/fact-tables/${factTable.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  autoSliceUpdatesEnabled: !factTable.autoSliceUpdatesEnabled,
                }),
              });
              await mutateDefinitions();
              setMenuOpen(false);
            }}
          >
            {factTable.autoSliceUpdatesEnabled
              ? "Turn off Auto Slice updates"
              : "Turn on Auto Slice updates"}
          </DropdownMenuItem>
        )}
        {page.canEditAggregatedSettings && (
          <DropdownMenuItem onClick={() => open("aggregated")}>
            Edit daily aggregation settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => open("audit")}>
          Audit log
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {page.canEdit || page.canDelete || page.canDuplicate ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {page.canDuplicate && (
              <DropdownMenuItem
                onClick={() => {
                  setDuplicate({
                    ...factTable,
                    name: `${factTable.name} (Copy)`,
                    managedBy:
                      factTable.managedBy === "admin" &&
                      permissionsUtil.canCreateOfficialResources(factTable)
                        ? "admin"
                        : "",
                  });
                  setMenuOpen(false);
                }}
              >
                Duplicate
              </DropdownMenuItem>
            )}
            {page.canEdit && (
              <DropdownMenuItem
                onClick={async () => {
                  await apiCall(
                    `/fact-tables/${factTable.id}/${
                      factTable.archived ? "unarchive" : "archive"
                    }`,
                    { method: "POST" },
                  );
                  mutateDefinitions();
                  setMenuOpen(false);
                }}
              >
                {factTable.archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
            )}
            {page.canDelete && (
              <DropdownMenuItem
                color="red"
                confirmation={{
                  confirmationTitle: "Delete Fact Table",
                  cta: "Delete",
                  submit: async () => {
                    await apiCall(`/fact-tables/${factTable.id}`, {
                      method: "DELETE",
                    });
                    mutateDefinitions();
                    router.push("/fact-tables");
                  },
                  closeDropdown: () => setMenuOpen(false),
                }}
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      ) : null}
    </DropdownMenu>
  );

  return {
    menu,
    modals,
    openSettings: () => open("settings"),
    openEditSql: () => open("sql"),
  };
}
