import { Separator } from "@radix-ui/themes";

// The rail's divider. --gray-a5, the same as the line between the main
// column and the rail (set in review). Separator's own default is
// --gray-a6. Shared by the Details and Comments tabs.
export default function RailDivider({
  my,
}: {
  // A space-scale step ("4") or a raw length ("20px").
  my?: string;
}) {
  return (
    <Separator size="4" my={my} style={{ backgroundColor: "var(--gray-a5)" }} />
  );
}
