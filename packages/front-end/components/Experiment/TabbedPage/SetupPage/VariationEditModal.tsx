import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton, TextArea } from "@radix-ui/themes";
import { PiImage, PiPlusBold, PiXBold } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Modal from "@/ui/Modal";
import ModalForm from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import commentStyles from "@/components/Comments/PlainCommentBox.module.scss";
import { ApplyButton } from "./InlineValues";
import { ValueDot } from "./SetupFunnel";
import { DraftVariation } from "./setupDraft";
import styles from "./VariationEditModal.module.scss";

// One variation's own modal, opened from its card's pencil (set in review):
// its name, description and images, and deleting it. Cancel / Apply on the
// right of the footer, Delete Variation on the left.
//
// Name, description and Delete edit the page's draft: Apply (or Delete)
// closes the modal and the save bar comes up; Save commits, Discard undoes.
// Images are the exception: the uploader (ScreenshotUpload, as everywhere
// in the app) saves each one to the experiment as it's added, and removing
// one is saved at once too. An unsaved (just added) variation has nowhere to
// put images yet, so they wait until it's saved.
//
// Built from @/ui/Modal's parts (as InlineValues' JSON editor) for the
// split footer. FALLBACK: Radix TextArea for the description; @/ui/ has no
// text area. Radix IconButton for an image's remove; @/ui/ has no icon
// button.

const imageCache = {};

// 12px at weight 500, 4px above its field: the Advanced cards' and the
// Edit Schedule modal's labels.
function FieldLabel({ children }: { children: string }) {
  return (
    <Text as="div" size="sm" weight="medium" mb="1">
      {children}
    </Text>
  );
}

export default function VariationEditModal({
  experiment,
  variation,
  index,
  canDelete,
  onApply,
  onDelete,
  close,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  // The variation as the draft has it.
  variation: DraftVariation;
  // Its position (the index on its card).
  index: number;
  // An experiment keeps at least two variations.
  canDelete: boolean;
  onApply: (changes: { name: string; description: string }) => void;
  onDelete: () => void;
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [name, setName] = useState(variation.name);
  const [description, setDescription] = useState(variation.description);
  const [nameError, setNameError] = useState<string | null>(null);

  // Images belong to the saved variation, by its saved position (which an
  // unsaved reorder doesn't change).
  const savedIndex = experiment.variations.findIndex(
    (v) => v.id === variation.id,
  );
  const saved = savedIndex >= 0 ? experiment.variations[savedIndex] : null;
  const screenshots = saved?.screenshots ?? [];

  // When an image is added out of view (e.g. starting a second row below
  // the fold), scroll the body all the way to the bottom, so it and the
  // 48px under it show (set in review). Not on open, and not when the new
  // image is already in full view.
  const latestRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(screenshots.length);
  useEffect(() => {
    const el = latestRef.current;
    if (screenshots.length > prevCount.current && el) {
      // The body's scroll viewport (Modal.Body is a Radix ScrollArea).
      const viewport = el.closest<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      );
      if (viewport) {
        const box = el.getBoundingClientRect();
        const view = viewport.getBoundingClientRect();
        if (box.bottom > view.bottom || box.top < view.top) {
          viewport.scrollTo({
            top: viewport.scrollHeight,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
          });
        }
      }
    }
    prevCount.current = screenshots.length;
  }, [screenshots.length]);

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // Large (800px), set in review.
      size="lg"
      hasDescription
      trackingEventModalType=""
    >
      <ModalForm
        onSubmit={async () => {
          // An empty name shows on the field itself (TextField's error
          // state), not as the modal's error callout (set in review).
          if (!name.trim()) {
            setNameError("Enter a name for this variation.");
            return;
          }
          onApply({ name: name.trim(), description });
          close();
        }}
      >
        <Modal.Header>
          <Modal.Title>Edit Variation</Modal.Title>
        </Modal.Header>
        {/* Which variation: its dot and index, as on its card. */}
        <Modal.Description>
          <span className={styles.which}>
            <ValueDot index={index} />
            {`Variation ${index}`}
          </span>
        </Modal.Description>
        {/* The body runs right up to the footer, so content scrolls on
          beneath it with no gap above it (as the JSON value modal; set in
          review): flushBottom here, flushTop on the footer, and the
          breathing room at the end of the content instead. */}
        <Modal.Body flushBottom>
          <Flex direction="column" gap="5">
            <Box>
              <FieldLabel>Name</FieldLabel>
              {/* The Setup page's field hover: the outline to --slate-9
                (.hoverFields; set in review). */}
              <TextField
                containerClassName={styles.hoverFields}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                error={nameError ?? undefined}
                aria-label="Name"
                autoFocus
              />
            </Box>
            <Box>
              <FieldLabel>Description</FieldLabel>
              {/* The Hypothesis field's text area styles (the comment box's
                shared ones): 12px padding all round, a --slate-9
                placeholder, and the hover outline (set in review). */}
              <TextArea
                className={clsx(
                  commentStyles.textArea,
                  commentStyles.hoverOutline,
                )}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's different in this variation?"
                aria-label="Description"
                // 8 lines (set in review): 8 × 20px, plus 12px of padding and
                // the 1px border top and bottom, 186px.
                rows={8}
              />
            </Box>
            <Box>
              <FieldLabel>Images</FieldLabel>
              {saved ? (
                // Five images to a row (set in review): equal columns with
                // 12px gaps, each image square at its column's width.
                <div className={styles.imageGrid}>
                  {screenshots.map((s, i) => (
                    <Box
                      key={s.path}
                      className={styles.thumb}
                      ref={i === screenshots.length - 1 ? latestRef : undefined}
                    >
                      <AuthorizedImage
                        imageCache={imageCache}
                        src={s.path}
                        className={styles.thumbImage}
                      />
                      <IconButton
                        type="button"
                        // 32px (Radix size 2) around a 14px × (set in
                        // review).
                        size="2"
                        variant="solid"
                        color="gray"
                        highContrast
                        radius="full"
                        className={styles.remove}
                        aria-label="Remove image"
                        onClick={async () => {
                          await apiCall(
                            `/experiment/${experiment.id}/variation/${savedIndex}/screenshot`,
                            {
                              method: "DELETE",
                              body: JSON.stringify({ url: s.path }),
                            },
                          );
                          mutate();
                        }}
                      >
                        <PiXBold size="14" />
                      </IconButton>
                    </Box>
                  ))}
                  {/* Click, drop or paste to attach; each one saves as it's
                    added. With no images yet, a full-width drop area; once
                    there's one, an add button (+) after the thumbnails
                    (both set in review). The button sits in the uploader's
                    drop zone, so a click opens the file picker and dropping
                    or pasting still works. */}
                  {screenshots.length ? (
                    <Box className={styles.addCell}>
                      <ScreenshotUpload
                        experiment={experiment.id}
                        variation={savedIndex}
                        onSuccess={() => mutate()}
                      >
                        {/* A tile the size and outline of an image, with no
                          fill and a bold + in the middle (set in review).
                          The uploader's drop zone around it takes clicks,
                          the keyboard, drops and pastes. */}
                        <div className={styles.addTile} title="Add image">
                          {/* 20px, set in review. */}
                          <PiPlusBold size="20" aria-hidden />
                          <span className="sr-only">Add image</span>
                        </div>
                      </ScreenshotUpload>
                    </Box>
                  ) : (
                    // The whole row, across the grid's columns.
                    <Box style={{ gridColumn: "1 / -1" }}>
                      <ScreenshotUpload
                        experiment={experiment.id}
                        variation={savedIndex}
                        onSuccess={() => mutate()}
                      >
                        <div className={styles.attach}>
                          {/* 20px, set in review. */}
                          <PiImage size="20" aria-hidden />
                          {/* 14px, set in review. */}
                          <Text size="md">Click, drop, or paste an image</Text>
                        </div>
                      </ScreenshotUpload>
                    </Box>
                  )}
                </div>
              ) : (
                <Text as="p" size="sm" color="text-mid">
                  Save the experiment to attach images to this variation.
                </Text>
              )}
            </Box>
          </Flex>
          {/* 48px after the content, so scrolled to the end the last row
            stops well short of the footer (set in review). */}
          <Box style={{ height: 48 }} aria-hidden />
        </Modal.Body>
        <Modal.Footer justify="between" flushTop>
          <Tooltip
            content="An experiment needs at least two variations."
            enabled={!canDelete}
          >
            <span>
              <Button
                variant="ghost"
                color="red"
                disabled={!canDelete}
                onClick={() => {
                  onDelete();
                  close();
                }}
              >
                Delete Variation
              </Button>
            </span>
          </Tooltip>
          <Flex gap="3">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <ApplyButton />
          </Flex>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}
