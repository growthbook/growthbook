import { LinkedFeatureInfo } from "shared/types/experiment";
import { ApiContextualBanditInterface } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import ContextualBanditLinkedFeatureFlag from "./ContextualBanditLinkedFeatureFlag";

export default function ContextualBanditLinkedFeatures({
  cb,
  linkedFeatures,
  canAddFeature,
  setFeatureModal,
  mutate,
}: {
  cb: ApiContextualBanditInterface;
  linkedFeatures: LinkedFeatureInfo[];
  canAddFeature?: boolean;
  setFeatureModal?: (open: boolean) => void;
  mutate?: () => void;
}) {
  return (
    <Frame>
      <Flex justify="between" align="center" mb="4" mx="1" gap="3">
        <Heading color="text-high" as="h4" size="small" mb="0">
          Linked Features
        </Heading>
        {canAddFeature && setFeatureModal ? (
          <Button variant="ghost" onClick={() => setFeatureModal(true)}>
            Add Feature Flag
          </Button>
        ) : null}
      </Flex>

      {linkedFeatures.length === 0 ? (
        <Box mx="1" my="2">
          <Text color="text-mid">
            <em>
              No feature flags are linked to this contextual bandit yet.
              {canAddFeature
                ? " Link a feature to serve different values per variation."
                : ""}
            </em>
          </Text>
        </Box>
      ) : (
        linkedFeatures.map((info) => (
          <ContextualBanditLinkedFeatureFlag
            key={info.feature.id}
            info={info}
            cb={cb}
            mutate={mutate}
          />
        ))
      )}
    </Frame>
  );
}
