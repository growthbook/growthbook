import React from "react";
import { DescriptionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { ScrollArea } from "@radix-ui/themes";
import Markdown from "react-markdown";
import { Box } from "spectacle";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from ".";

export default function DescriptionBlock({
  block: { experimentId },
}: BlockProps<DescriptionBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;
  return (
    <>
      {experiment.description ? (
        <Box as="div" py="2">
          <ScrollArea
            style={{
              maxHeight: "491px",
            }}
          >
            <Markdown>{experiment.description}</Markdown>
          </ScrollArea>
        </Box>
      ) : (
        <Box as="div" className="font-italic text-muted" py="2">
          This experiment doesn&apos;t have a description yet.
        </Box>
      )}
    </>
  );
}
