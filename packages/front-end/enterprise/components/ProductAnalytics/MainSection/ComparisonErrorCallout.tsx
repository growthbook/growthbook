import Callout from "@/ui/Callout";

// Shared by the Explorer and dashboard tiles so the failure reads the same in both.
export default function ComparisonErrorCallout({ error }: { error: string }) {
  return (
    <Callout status="warning" size="sm">
      {`The comparison period could not be loaded, so only the current period is shown: ${error}`}
    </Callout>
  );
}
