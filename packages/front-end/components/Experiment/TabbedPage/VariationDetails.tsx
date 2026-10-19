import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationLabel from "@/ui/VariationLabel";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
import { ScreenshotCarousel } from "@/components/Experiment/VariationsTable";

const imageCache = {};

const THUMBNAIL_WIDTH = 118;
const THUMBNAIL_HEIGHT = 74;

export default function VariationDetails({
  experiment,
  onEdit,
}: {
  experiment: ExperimentInterfaceStringDates;
  onEdit?: (variationIndex: number) => void;
}) {
  const variations = getLatestPhaseVariations(experiment);
  const [openCarousel, setOpenCarousel] = useState<{
    variationId: string;
    index: number;
  } | null>(null);

  if (!variations.length) return null;

  return (
    <Box className="appbox mb-0" mt="4" style={{ overflow: "hidden" }}>
      <Box px="3" py="3" style={{ borderBottom: "1px solid var(--gray-a5)" }}>
        <Heading as="h4" size="sm" color="text-high" mb="0">
          Variation details
        </Heading>
      </Box>
      {variations.map((v, i) => (
        <Flex
          key={v.id}
          align="start"
          gap="4"
          px="3"
          py="3"
          style={{
            borderTop: i ? "1px solid var(--gray-a4)" : undefined,
          }}
        >
          <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
            <VariationLabel number={v.index} name={v.name} />
            {v.description ? (
              <Text size="sm" color="text-mid">
                {v.description}
              </Text>
            ) : (
              <Text size="sm" color="text-disabled">
                No description
              </Text>
            )}
          </Flex>
          {v.screenshots.length ? (
            <Box
              flexShrink="0"
              style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }}
            >
              <ScreenshotCarousel
                variation={v}
                maxChildHeight={THUMBNAIL_HEIGHT}
                onClick={(index) =>
                  setOpenCarousel({ variationId: v.id, index })
                }
              />
            </Box>
          ) : null}
          {onEdit ? (
            <Tooltip content="Edit variation">
              <IconButton
                variant="ghost"
                color="violet"
                radius="medium"
                size="1"
                onClick={() => onEdit(i)}
                aria-label={`Edit ${v.name}`}
              >
                <PiPencilSimple size="14" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Flex>
      ))}
      {openCarousel ? (
        <ExperimentCarouselModal
          experiment={experiment}
          currentVariation={openCarousel.variationId}
          currentScreenshot={openCarousel.index}
          imageCache={imageCache}
          close={() => setOpenCarousel(null)}
        />
      ) : null}
    </Box>
  );
}
