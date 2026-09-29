import { Flex } from "@radix-ui/themes";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";
import { useManagedFlagRename } from "@/components/Experiment/ManagedFlagRename";

const { component: FlagIcon, radixColor: FLAG_COLOR } =
  ICON_PROPERTIES["feature-flag"];

// Not a link: the flag is edited from the experiment, not from its own page.
export function ManagedFlagName({ featureId }: { featureId: string }) {
  return (
    <Flex align="center" gap="3">
      <Avatar radius="small" color={FLAG_COLOR} size="sm" variant="soft">
        <FlagIcon />
      </Avatar>
      <Text weight="medium">{featureId}</Text>
    </Flex>
  );
}

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
