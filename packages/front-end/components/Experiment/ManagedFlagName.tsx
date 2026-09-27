import { Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";
import { useManagedFlagRename } from "@/components/Experiment/ManagedFlagRename";
import QuickEditButton, {
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";

// The shared Linked Change icon, so a Feature Flag looks the same everywhere.
const { component: FlagIcon, radixColor: FLAG_COLOR } =
  ICON_PROPERTIES["feature-flag"];

// Not a link: the flag is edited from the experiment, not from its own page.
export function ManagedFlagName({
  featureId,
  children,
}: {
  featureId: string;
  children?: ReactNode;
}) {
  return (
    <Flex align="center" gap="3">
      <Avatar radius="small" color={FLAG_COLOR} size="sm" variant="soft">
        <FlagIcon />
      </Avatar>
      <Text weight="medium">{featureId}</Text>
      {children}
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

/** Renames the managed flag, where the page allows it. */
export function ManagedFlagRenameButton({ featureId }: { featureId: string }) {
  const { edit } = useManagedFlagRename(featureId);
  return edit ? (
    <QuickEditButton label="Rename Feature Flag" onClick={edit} />
  ) : null;
}

/** "Managed flag: <id>", muted, for wherever the experiment's own flag is named in passing. */
export function ManagedFlagNote({ featureId }: { featureId: string }) {
  return (
    <Flex align="center" gap="1" className={revealsQuickEdit}>
      <Text as="div" size="sm" color="text-low">
        Managed flag: <ManagedFlagLink featureId={featureId} />
      </Text>
      <ManagedFlagRenameButton featureId={featureId} />
    </Flex>
  );
}
