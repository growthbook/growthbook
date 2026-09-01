import { ApiContextualBanditInterface } from "shared/validators";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box, Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import ContextualBanditVisualChangesetRow from "./ContextualBanditVisualChangesetRow";

export default function ContextualBanditVisualChangesets({
  cb,
  visualChangesets,
  canEdit,
  setVisualChangesetModal,
  mutate,
}: {
  cb: ApiContextualBanditInterface;
  visualChangesets: VisualChangesetInterface[];
  canEdit?: boolean;
  setVisualChangesetModal?: (open: boolean) => void;
  mutate?: () => void;
}) {
  return (
    <Frame>
      <Flex justify="between" align="center" mb="4" mx="1" gap="3">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          Visual Changes
        </Heading>
        {canEdit && setVisualChangesetModal ? (
          <Button
            variant="ghost"
            onClick={() => setVisualChangesetModal(true)}
          >
            Add Visual Change
          </Button>
        ) : null}
      </Flex>

      {visualChangesets.length === 0 ? (
        <Box mx="1" my="2">
          <Text color="text-mid">
            <em>
              No visual changes are attached to this contextual bandit yet.
              {canEdit
                ? " Add a visual change to run per-variation DOM edits."
                : ""}
            </em>
          </Text>
        </Box>
      ) : (
        visualChangesets.map((vc) => (
          <ContextualBanditVisualChangesetRow
            key={vc.id}
            cb={cb}
            visualChangeset={vc}
            mutate={mutate}
          />
        ))
      )}
    </Frame>
  );
}
