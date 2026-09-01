import { ApiContextualBanditInterface } from "shared/validators";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box, Flex } from "@radix-ui/themes";
import Avatar from "@/ui/Avatar";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";

export default function ContextualBanditVisualChangesetRow({
  cb,
  visualChangeset,
}: {
  cb: ApiContextualBanditInterface;
  visualChangeset: VisualChangesetInterface;
  mutate?: () => void;
}) {
  const { component: Icon, radixColor } = ICON_PROPERTIES["visual-editor"];

  const changesCount = visualChangeset.visualChanges.filter(
    (vc) =>
      (vc.css && vc.css.trim().length > 0) ||
      (vc.js && vc.js.trim().length > 0) ||
      (vc.domMutations && vc.domMutations.length > 0),
  ).length;

  const canLaunchEditor =
    !cb.archived && cb.status !== "stopped";

  const primaryUrl =
    visualChangeset.urlPatterns.find((p) => p.include)?.pattern ||
    visualChangeset.urlPatterns[0]?.pattern ||
    visualChangeset.editorUrl;

  return (
    <Box className="my-3" p="1">
      <Flex gap="3" justify="between" align="center">
        <Flex gap="3" align="center">
          <Avatar radius="small" color={radixColor} size="md" variant="soft">
            <Icon />
          </Avatar>
          <Heading as="h4" size="sm" weight="medium" mb="0">
            {primaryUrl}
          </Heading>
          <Box>&middot;</Box>
          <Text color="text-low">
            {changesCount > 0
              ? `${changesCount} variation${changesCount === 1 ? "" : "s"} with changes`
              : "no changes yet"}
          </Text>
        </Flex>
        {canLaunchEditor && (
          <OpenVisualEditorLink
            useRadix={false}
            visualChangeset={visualChangeset}
            useLink={true}
            button={<Button variant="ghost">Launch Visual Editor</Button>}
          />
        )}
      </Flex>
    </Box>
  );
}
