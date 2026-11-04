import { PiCaretDownFill, PiCheck } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { SaveDestination } from "./useSdkConnectionRevisionFlow";

function Choice({ selected, label }: { selected: boolean; label: string }) {
  return (
    <Flex align="center" gap="2">
      <Box width="16px" style={{ display: "flex" }}>
        {selected ? <PiCheck /> : null}
      </Box>
      {label}
    </Flex>
  );
}

// Save, labelled with where the changes go; the menu picks another destination.
export default function SDKConnectionSaveButton({
  destination,
  revisionAware,
  onSave,
}: {
  destination: SaveDestination;
  revisionAware: boolean;
  onSave: () => Promise<void>;
}) {
  if (!revisionAware) return <Button onClick={onSave}>Save</Button>;

  const {
    mode,
    drafts,
    selectedDraftId,
    selectedDraftLabel,
    canAutoPublish,
    approvalRequired,
    metadataOnly,
    singleOption,
    choose,
  } = destination;
  const bypass = mode === "publish" && approvalRequired;

  const label =
    mode === "publish"
      ? bypass
        ? "Bypass approvals and publish"
        : "Publish"
      : mode === "existing"
        ? `Save to ${selectedDraftLabel ?? "draft"}`
        : metadataOnly
          ? "Save to a new revision"
          : "Save as new draft";

  const save = (
    <Button color={bypass ? "red" : undefined} onClick={onSave}>
      {label}
    </Button>
  );
  if (singleOption) return save;

  return (
    <SplitButton
      menu={
        <DropdownMenu
          trigger={
            <Button
              color={bypass ? "red" : undefined}
              aria-label="Choose where to save"
            >
              <PiCaretDownFill />
            </Button>
          }
          menuPlacement="end"
          menuSide="top"
        >
          {drafts.map((d) => (
            <DropdownMenuItem
              key={d.id}
              onClick={() => choose("existing", d.id)}
            >
              <Choice
                selected={mode === "existing" && selectedDraftId === d.id}
                label={`Add to ${d.label}`}
              />
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => choose("new")}>
            <Choice
              selected={mode === "new"}
              label={
                metadataOnly ? "Add to a new revision" : "Create a new draft"
              }
            />
          </DropdownMenuItem>
          {canAutoPublish ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                color={approvalRequired ? "red" : undefined}
                onClick={() => choose("publish")}
              >
                <Choice
                  selected={mode === "publish"}
                  label={
                    approvalRequired
                      ? "Bypass approvals and publish now"
                      : "Publish now"
                  }
                />
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenu>
      }
    >
      {save}
    </SplitButton>
  );
}
