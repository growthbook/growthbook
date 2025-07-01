import React from "react";
import { DescriptionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { Blockquote, ScrollArea } from "@radix-ui/themes";
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
    <Blockquote>
      {experiment.description ? (
        <ScrollArea
          style={{
            maxHeight: "491px",
          }}
        >
          <Markdown>{experiment.description}</Markdown>
        </ScrollArea>
      ) : (
        <Box as="div" className="font-italic text-muted" py="2">
          Add a description to keep your team informed about the purpose and
          parameters of your experiment
        </Box>
      )}
    </Blockquote>
  );
}
