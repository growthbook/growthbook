import { Flex } from "@radix-ui/themes";
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownSubMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./DropdownMenu";

export default function DropdownMenuStories() {
  return (
    <Flex direction="row" justify="between">
      <DropdownMenu trigger="Menu">
        <DropdownMenuLabel>Menu Label</DropdownMenuLabel>
        <DropdownSubMenu trigger="Item 1">
          <DropdownMenuItem>Item 1.1</DropdownMenuItem>
        </DropdownSubMenu>
        <DropdownMenuItem
          onClick={function (): void {
            alert("Item 2");
          }}
        >
          Item 2
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Item 3</DropdownMenuItem>
        <DropdownMenuItem disabled>Item 4</DropdownMenuItem>
        <DropdownMenuItem color="red">Item 5</DropdownMenuItem>
      </DropdownMenu>

      <DropdownMenu trigger="Add Experiment" menuPlacement="end">
        <DropdownMenuItem>Create New Experiment</DropdownMenuItem>
        <DropdownMenuItem>Import Existing Experiment</DropdownMenuItem>
      </DropdownMenu>

      {/* menuMaxHeight caps the menu and lets Radix's own viewport scroll, so
          long lists need no scrolling wrapper around the items. */}
      <DropdownMenu trigger="Long list" menuMaxHeight={200}>
        {Array.from({ length: 20 }, (_, i) => (
          <DropdownMenuItem key={i}>Item {i + 1}</DropdownMenuItem>
        ))}
      </DropdownMenu>
    </Flex>
  );
}
