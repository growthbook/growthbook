import {
  ApiContextualBanditInterface,
  ApiVisualChangeset,
} from "shared/validators";
import { visualChangeHasContent } from "shared/util";
import { canEditContextualBanditVisualChanges } from "shared/experiments";
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
  visualChangeset: ApiVisualChangeset;
}) {
  const { component: Icon, radixColor } = ICON_PROPERTIES["visual-editor"];

  const changesCount = visualChangeset.visualChanges.filter(
    visualChangeHasContent,
  ).length;

  const changesetId = visualChangeset.id;
  const canLaunchEditor = canEditContextualBanditVisualChanges(cb);

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
        {canLaunchEditor && changesetId && (
          <OpenVisualEditorLink
            useRadix={false}
            visualChangeset={{
              id: changesetId,
              editorUrl: visualChangeset.editorUrl,
            }}
            useLink={true}
            button={<Button variant="ghost">Launch Visual Editor</Button>}
          />
        )}
      </Flex>
    </Box>
  );
}
