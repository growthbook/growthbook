import { useState } from "react";
import clsx from "clsx";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExperimentInterfaceStringDates,
  Screenshot,
} from "shared/types/experiment";
import { PiTrash, PiCameraPlusLight } from "react-icons/pi";
import AuthorizedImage from "@/components/AuthorizedImage";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import Tooltip from "@/ui/Tooltip";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
// The same placeholder treatment the variation card uses, hover states included.
import placeholderStyles from "@/components/Experiment/VariationsTable.module.scss";
import styles from "./VariationScreenshotManager.module.scss";

// Square, so a row of thumbnails reads as a grid rather than a filmstrip.
const TILE_ASPECT = "1 / 1";

// Signed URLs are fetched per image; sharing one cache across the grid keeps a
// reorder from re-requesting every tile.
const imageCache = {};

function ScreenshotTile({
  screenshot,
  onDelete,
  onOpen,
}: {
  screenshot: Screenshot;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: screenshot.path });
  const [hovered, setHovered] = useState(false);

  return (
    <Box
      ref={setNodeRef}
      position="relative"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Above the tiles it is being dragged across, which are painted later
        // in DOM order once it moves past them.
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.5 : undefined,
        cursor: "grab",
        aspectRatio: TILE_ASPECT,
        borderRadius: 5,
        overflow: "hidden",
        border: "1px solid var(--slate-a4)",
        background: "var(--black-a1)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <AuthorizedImage
        imageCache={imageCache}
        src={screenshot.path}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
      {hovered ? (
        <Box position="absolute" top="2" right="2">
          <Tooltip content="Remove image" side="top">
            <IconButton
              type="button"
              size="2"
              color="red"
              variant="solid"
              radius="full"
              className={styles.deleteButton}
              aria-label="Remove image"
              // The tile itself is the drag handle, so the button has to opt out.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <PiTrash size={16} />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Grid of a variation's screenshots: reorder by dragging, remove on hover, and
 * add more. Uploads land immediately (they are file writes); order and removals
 * ride along with the form's own save.
 */
export default function VariationScreenshotManager({
  experiment,
  variationIndex,
  screenshots,
  setScreenshots,
}: {
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  screenshots: Screenshot[];
  setScreenshots: (screenshots: Screenshot[]) => void;
}) {
  // The tile is its own drag handle, so a drag only starts once the pointer
  // actually moves — otherwise a plain click never reaches the tile.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {}),
  );
  // The viewer reads the experiment's saved screenshots, so it is addressed by
  // index into those rather than into this component's staged list.
  const variation = experiment.variations[variationIndex];
  const [lightbox, setLightbox] = useState<number | null>(null);
  const openLightbox = (screenshot: Screenshot) => {
    const i = (variation?.screenshots ?? []).findIndex(
      (s) => s.path === screenshot.path,
    );
    setLightbox(Math.max(0, i));
  };

  return (
    <Box>
      {/* Matches the fields above, which render a plain bold label. */}
      <label style={{ fontWeight: 600 }}>Screenshots</label>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const oldIndex = screenshots.findIndex((s) => s.path === active.id);
          const newIndex = screenshots.findIndex((s) => s.path === over.id);
          if (oldIndex < 0 || newIndex < 0) return;
          setScreenshots(arrayMove(screenshots, oldIndex, newIndex));
        }}
      >
        <SortableContext
          items={screenshots.map((s) => s.path)}
          strategy={rectSortingStrategy}
        >
          <Grid columns="4" gap="4">
            <ScreenshotUpload
              experiment={experiment.id}
              variation={variationIndex}
              className={styles.gridUpload}
              messageClassName={styles.gridUploadMessage}
              message="Drop image here"
              onSuccess={(_, screenshot) =>
                setScreenshots([...screenshots, screenshot])
              }
            >
              <Flex
                align="center"
                justify="center"
                width="100%"
                className={clsx(
                  "appbox mb-0",
                  styles.uploadTile,
                  placeholderStyles.noImageBox,
                  placeholderStyles.noImageBoxEditable,
                )}
                style={{ aspectRatio: TILE_ASPECT, border: "none" }}
              >
                <PiCameraPlusLight size={32} />
                <span className={styles.uploadHint}>Upload image</span>
              </Flex>
            </ScreenshotUpload>
            {screenshots.map((s) => (
              <ScreenshotTile
                key={s.path}
                screenshot={s}
                onOpen={() => openLightbox(s)}
                onDelete={() =>
                  setScreenshots(
                    screenshots.filter((other) => other.path !== s.path),
                  )
                }
              />
            ))}
          </Grid>
        </SortableContext>
      </DndContext>
      {lightbox !== null && variation ? (
        <ExperimentCarouselModal
          experiment={experiment}
          currentVariation={variation.id}
          currentScreenshot={lightbox}
          imageCache={imageCache}
          close={() => setLightbox(null)}
          restrictVariation
        />
      ) : null}
    </Box>
  );
}
