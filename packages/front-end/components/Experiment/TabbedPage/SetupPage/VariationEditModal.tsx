import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton, TextArea } from "@radix-ui/themes";
import { PiImage, PiPlusBold, PiXBold } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import ScreenshotUpload from "@/components/EditExperiment/ScreenshotUpload";
import AuthorizedImage from "@/components/AuthorizedImage";
import Modal, { useModalContext } from "@/ui/Modal";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
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

  // Modal.Root's close, which plays the fade-out first, for the form's
  // submit and Delete (defined out here, outside the modal's context).
  const requestCloseRef = useRef<(() => void) | null>(null);

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // Large (800px), set in review.
      size="lg"
      // No description: which variation it is shows as its dot in the Name
      // field.
      hasDescription={false}
      trackingEventModalType=""
      // The Create Experiment modal's chrome (set in review): lighter
      // dividers, 32px sides, and the soft fade in and out.
      dividerColor="var(--gray-a5)"
      paddingX="var(--space-6)"
      fadeIn
    >
      <RequestCloseBridge requestCloseRef={requestCloseRef} />
      <ModalForm
        onSubmit={async () => {
          // An empty name shows on the field itself (TextField's error
          // state), not as the modal's error callout (set in review).
          if (!name.trim()) {
            setNameError("Enter a name for this variation.");
            return;
          }
          onApply({ name: name.trim(), description });
          // Through Modal.Root, so the fade-out plays first.
          (requestCloseRef.current ?? close)();
        }}
      >
        {/* As the Create Experiment modal's header (set in review): a
          divider under it, the title as a page heading, and a close button
          at its right, with no height of its own, so the trimmed title sets
          the header's height. Which variation it is shows as its dot in the
          Name field (set in review; it was in the header, and before that a
          description). FALLBACK: Radix IconButton; @/ui/ has no icon
          button. */}
        <Modal.Header divider>
          <Modal.Title pageHeading>Edit Variation</Modal.Title>
          <Flex align="center" style={{ height: 0, marginLeft: "auto" }}>
            <Modal.Close>
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="1"
                aria-label="Close"
              >
                <PiXBold size={16} style={{ color: "var(--slate-10)" }} />
              </IconButton>
            </Modal.Close>
          </Flex>
        </Modal.Header>
        {/* The body scrolls right up to the header's and footer's dividers
          (scrollToEdges, as the Create Experiment modal; set in review),
          with 28px above the content and 40px below it, inside the
          scroll. */}
        <Modal.Body scrollToEdges>
          <Flex direction="column" gap="5">
            <Box>
              <FieldLabel>Name</FieldLabel>
              {/* The Setup page's field hover: the outline to --slate-9
                (.hoverFields; set in review). */}
              <TextField
                containerClassName={clsx(styles.hoverFields, styles.nameField)}
                // The variation's dot at the field's left, as on its card (set
                // in review): which variation this is. Just a marker.
                prepend={<ValueDot index={index} />}
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
                // Focused, the hover's --slate-9 outline and no violet ring
                // (set in review), as the rail's comment box.
                className={clsx(
                  commentStyles.textArea,
                  commentStyles.hoverOutline,
                  commentStyles.focusAsHover,
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
                  // Through Modal.Root, so the fade-out plays first.
                  (requestCloseRef.current ?? close)();
                }}
              >
                Delete Variation
              </Button>
            </span>
          </Tooltip>
          <Flex gap="3">
            {/* As the Create Experiment modal's Cancel (set in review):
              grey, --slate-12 text at 400, 6px corners on its hover fill.
              It closes through Modal.Close, so the fade-out plays;
              @/ui/Button's default preventDefault would cancel that
              click. */}
            <Modal.Close>
              <Button
                variant="ghost"
                color="gray"
                preventDefault={false}
                className={modalStandardStyles.ghostButton}
                style={{
                  borderRadius: "var(--radius-3)",
                  color: "var(--slate-12)",
                }}
              >
                Cancel
              </Button>
            </Modal.Close>
            <ApplyButton />
          </Flex>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

// Hands Modal.Root's close (which fades out first) to the code around the
// modal, which sits outside its context.
function RequestCloseBridge({
  requestCloseRef,
}: {
  requestCloseRef: React.MutableRefObject<(() => void) | null>;
}) {
  const { requestClose } = useModalContext();
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose, requestCloseRef]);
  return null;
}
