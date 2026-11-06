import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { useManagedFlagRename } from "@/components/Experiment/ManagedFlagRename";

/**
 * The managed flag's id as a link to its page, or as plain text while a
 * rename is staged, since the new id doesn't exist yet.
 */
export function ManagedFlagLink({ featureId }: { featureId: string }) {
  const { featureId: shownId, staged } = useManagedFlagRename(featureId);
  if (staged) {
    return (
      <Text size="sm" color="text-high">
        {shownId}
      </Text>
    );
  }
  return (
    // A new tab, so following it never costs the page's edits.
    <Link
      href={`/features/${featureId}`}
      external
      color="dark"
      size="sm"
      weight="regular"
    >
      {featureId}
    </Link>
  );
}
