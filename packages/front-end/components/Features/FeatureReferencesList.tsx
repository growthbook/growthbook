import { FC } from "react";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";

interface FeatureReferencesListProps {
  features?: string[];
  experiments?: Array<{ id: string; name: string }>;
}

const FeatureReferencesList: FC<FeatureReferencesListProps> = ({
  features = [],
  experiments = [],
}) => {
  return (
    <Box>
      {features.length > 0 && (
        <Flex
          gap="2"
          p="3"
          mb="4"
          align="start"
          className="bg-highlight rounded"
          direction="column"
        >
          <Collapsible
            trigger={
              <Flex align="center" gap="1">
                <PiCaretRightFill className="chevron" />
                <Heading size="2" mb="0">
                  Dependent Features
                </Heading>
                <Badge radius="full" label={features.length.toString()} />
              </Flex>
            }
            open={true}
            transitionTime={100}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-4)",
                marginTop: "var(--space-2)",
              }}
            >
              {features.map((featureId) => (
                <li key={featureId}>
                  <Link href={`/features/${featureId}`} target="_blank">
                    {featureId}
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Flex>
      )}
      {experiments.length > 0 && (
        <Flex
          gap="2"
          p="3"
          mb="4"
          align="start"
          className="bg-highlight rounded"
          direction="column"
        >
          <Collapsible
            trigger={
              <Flex align="center" gap="1">
                <PiCaretRightFill className="chevron" />
                <Heading size="2" mb="0">
                  Dependent Experiments
                </Heading>
                <Badge radius="full" label={experiments.length.toString()} />
              </Flex>
            }
            open={true}
            transitionTime={100}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-4)",
                marginTop: "var(--space-2)",
              }}
            >
              {experiments.map((experiment) => (
                <li key={experiment.id}>
                  <Link href={`/experiment/${experiment.id}`} target="_blank">
                    {experiment.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </Flex>
      )}
    </Box>
  );
};

export default FeatureReferencesList;
