import { Dispatch, SetStateAction, useMemo, useState } from "react";
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
} from "@dnd-kit/sortable";
import {
  ExperimentInterfaceStringDates,
  Screenshot,
} from "shared/types/experiment";
import { PiTrash, PiCameraPlusLight } from "react-icons/pi";
import AuthorizedImage from "@/components/AuthorizedImage";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import Tooltip from "@/ui/Tooltip";
import ExperimentCarouselModal from "@/components/Experiment/ExperimentCarouselModal";
import placeholderStyles from "@/components/Experiment/VariationsTable.module.scss";
import useSortableItem from "@/hooks/useSortableItem";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import styles from "./VariationScreenshotManager.module.scss";

const TILE_ASPECT = "1 / 1";

// Shared so a reorder doesn't re-request every signed URL.
const imageCache = {};

// An element, not a component, so a tooltip can use it as its trigger.
function uploadTile(blocked: boolean) {
  return (
    <Flex
      align="center"
      justify="center"
      width="100%"
      className={clsx(
        "appbox mb-0",
        styles.uploadTile,
        placeholderStyles.noImageBox,
        !blocked && placeholderStyles.noImageBoxEditable,
      )}
      style={{
        aspectRatio: TILE_ASPECT,
        border: "none",
        cursor: blocked ? "not-allowed" : undefined,
      }}
      aria-disabled={blocked || undefined}
    >
      <PiCameraPlusLight size={32} />
      {blocked ? null : <span className={styles.uploadHint}>Upload image</span>}
    </Flex>
  );
}

function ScreenshotTile({
  screenshot,
  onDelete,
  onOpen,
}: {
  screenshot: Screenshot;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const { setNodeRef, style, isDragging, handle } = useSortableItem(
    screenshot.path,
  );

  return (
    <Box
      ref={setNodeRef}
      className={styles.tile}
      style={{
        ...style,
        opacity: isDragging ? 0.5 : undefined,
        cursor: "grab",
        aspectRatio: TILE_ASPECT,
        borderRadius: 5,
        overflow: "hidden",
        border: "1px solid var(--slate-a4)",
        background: "var(--black-a1)",
      }}
      onClick={onOpen}
      {...handle}
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
      {/* Always mounted so touch and keyboard users can reach it. */}
      <Box position="absolute" top="2" right="2" className={styles.deleteSlot}>
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
    </Box>
  );
}

// Uploads land immediately; order and removals ride along with the form's save.
// So cancelling won't undo an upload, and a removed file stays in storage.
export default function VariationScreenshotManager({
  experiment,
  variationIndex,
  screenshots,
  setScreenshots,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  screenshots: Screenshot[];
  // Updaters, since a multi-file drop adds them one at a time.
  setScreenshots: Dispatch<SetStateAction<Screenshot[]>>;
  // The upload is already saved; the page's copy has to catch up before its save.
  mutate: () => void;
}) {
  // The tile is its own drag handle, so a click needs movement to become a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {}),
  );
  // The viewer reads screenshots off the experiment, which still holds the
  // saved ones.
  const variation = experiment.variations[variationIndex];
  const stagedExperiment = useMemo(
    () => ({
      ...experiment,
      variations: experiment.variations.map((v, i) =>
        i === variationIndex ? { ...v, screenshots } : v,
      ),
    }),
    [experiment, variationIndex, screenshots],
  );
  const [lightbox, setLightbox] = useState<number | null>(null);
  // An upload writes straight to the stored variation at this index, which
  // staged edits may have moved; their save would also drop it.
  const uploadBlocked = useEditsBlockedReason();

  return (
    <Box>
      <label style={{ fontWeight: 600 }}>Screenshots</label>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          setScreenshots((prev) => {
            const oldIndex = prev.findIndex((s) => s.path === active.id);
            const newIndex = prev.findIndex((s) => s.path === over.id);
            if (oldIndex < 0 || newIndex < 0) return prev;
            return arrayMove(prev, oldIndex, newIndex);
          });
        }}
      >
        <SortableContext
          items={screenshots.map((s) => s.path)}
          strategy={rectSortingStrategy}
        >
          <Grid columns="4" gap="4">
            {uploadBlocked ? (
              <Tooltip content={uploadBlocked} side="top">
                {uploadTile(true)}
              </Tooltip>
            ) : (
              <ScreenshotUpload
                experiment={experiment.id}
                variation={variationIndex}
                className={styles.gridUpload}
                messageClassName={styles.gridUploadMessage}
                message="Drop image here"
                onSuccess={(_, screenshot) => {
                  setScreenshots((prev) => [...prev, screenshot]);
                  mutate();
                }}
              >
                {uploadTile(false)}
              </ScreenshotUpload>
            )}
            {screenshots.map((s, i) => (
              <ScreenshotTile
                key={s.path}
                screenshot={s}
                onOpen={() => setLightbox(i)}
                onDelete={() =>
                  setScreenshots((prev) =>
                    prev.filter((other) => other.path !== s.path),
                  )
                }
              />
            ))}
          </Grid>
        </SortableContext>
      </DndContext>
      {lightbox !== null && variation ? (
        <ExperimentCarouselModal
          experiment={stagedExperiment}
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
