import React, { Fragment, ReactElement } from "react";
import { ExperimentMetadataBlockInterface } from "shared/enterprise";
import { getVariationsForPhase } from "shared/experiments";
import { ScrollArea, Separator, Text } from "@radix-ui/themes";
import { Box } from "spectacle";
import Markdown from "@/components/Markdown/Markdown";
import VariationsTable from "@/components/Experiment/VariationsTable";
import { BlockProps } from ".";

export default function ExperimentMetadataBlock({
  block: { showDescription, showHypothesis, showVariationImages, variationIds },
  experiment,
}: BlockProps<ExperimentMetadataBlockInterface>) {
  const variationsList =
    (variationIds ?? []).length === 0
      ? getVariationsForPhase(experiment, null).map(({ id }) => id)
      : variationIds;

  const blockParts: ReactElement[] = [];

  if (showDescription) {
    blockParts.push(
      <>
        <Text weight="medium" size="3">
          Description
        </Text>
        {experiment.description ? (
          <Box as="div" py="2" style={{ opacity: 0.8 }}>
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
      </>,
    );
  }
  if (showHypothesis) {
    blockParts.push(
      <>
        <Text weight="medium" size="3">
          Hypothesis
        </Text>
        {experiment.hypothesis ? (
          <Box as="div" py="2" style={{ opacity: 0.8 }}>
            {experiment.hypothesis}
          </Box>
        ) : (
          <Box as="div" className="font-italic text-muted" py="2">
            This experiment doesn&apos;t have a hypothesis yet.
          </Box>
        )}
      </>,
    );
  }
  if (showVariationImages) {
    blockParts.push(
      <>
        <Text weight="medium" size="3" mb="2">
          Variations
        </Text>
        <div className="variation-image-block">
          <VariationsTable
            experiment={experiment}
            variationsList={variationsList}
            canEditExperiment={false}
            allowImages={true}
            noMargin={true}
          />
        </div>
      </>,
    );
  }

  return (
    <>
      {blockParts.map((block, i) => (
        <Fragment key={i}>
          {block}
          {i < blockParts.length - 1 && <Separator size="4" my="3" />}
        </Fragment>
      ))}
    </>
  );
}
