import { useEffect, useRef, useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
import Modal, { useModalContext } from "@/ui/Modal";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
import ModalForm from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import TextField from "@/ui/TextField";
import { ApplyButton } from "./InlineValues";
import VariationSplitTable, { SPLIT_COLUMN_PX } from "./VariationSplitTable";
import styles from "./SplitEditModal.module.scss";
import { evenSplit, normalizeSplit, round1, settleTo100 } from "./splitMath";

// The Edit Split % modal (set in review), opened from the split pills above
// the variation cards, on a draft. Laid out as a table (set in review, after
// the design's reference): a row per variation, its number and name on the
// left and its Split % field on the right, under a Variation / Split %
// header row, with Split Even as a link beside the Split % label. Footer:
// Cancel and Apply.
//
// The form can never hold an invalid total. Fields are free while typing;
// when one loses focus its value is clamped to 0–100 (one decimal place)
// and the remainder is shared among the OTHER variations in proportion to
// their current values (evenly if they're all 0). Rounding leftovers go to
// the largest of the adjusted variations, so the total is always exactly 100.
// Fields the normalisation changed flash briefly, and a polite live region
// says which moved. Split Even applies 100 / N with the same rounding rule,
// and shows only once the split is no longer even. Apply is never disabled: it
// normalises the focused field first.
//
// Apply writes to the page draft (the save bar comes up); nothing is saved
// here. Cancel, Escape and a click outside discard the modal's changes.
//
// Built only from design-system parts: @/ui/Modal's parts, @/ui/Table,
// @/ui/VariationNumber, @/ui/TextField, @/ui/Text, @/ui/Link, @/ui/Button.

const FLASH_MS = 1200;

function toText(n: number): string {
  return String(round1(n));
}

export default function SplitEditModal({
  variations,
  weights,
  onConfirm,
  close,
  focusVariationId = null,
}: {
  // In the page's order.
  variations: { id: string; name: string }[];
  // Fractions, aligned with variations.
  weights: number[];
  // Fractions, aligned with variations.
  onConfirm: (weights: number[]) => void;
  close: () => void;
  // The variation whose split pill opened the modal: its field takes focus
  // (set in review). The first variation's when unset or not found.
  focusVariationId?: string | null;
}) {
  // Start from the current split, settled to exactly 100 at one decimal.
  const [values, setValues] = useState<number[]>(() =>
    settleTo100(
      weights.map((w) => round1(w * 100)),
      weights.map((_, i) => i),
    ),
  );
  // What each field shows, so typing isn't rewritten mid-keystroke.
  const [texts, setTexts] = useState<string[]>(() => values.map(toText));
  const [focused, setFocused] = useState<number | null>(null);
  const [flashing, setFlashing] = useState<Set<number>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const focusInput = useRef<HTMLInputElement>(null);
  const focusIndex = Math.max(
    0,
    variations.findIndex((v) => v.id === focusVariationId),
  );
  // Already even: every value within one rounding step (0.1) of the rest,
  // as Split Even leaves it (e.g. 33.4 / 33.3 / 33.3, in any order).
  const isEven =
    Math.max(...values) - Math.min(...values) <= 0.1 + Number.EPSILON;
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  // Focus the clicked variation's field (the first's by default), after
  // the dialog's own initial focus, with the cursor after its value (set in
  // review; it was selected). Number fields don't take a selection range,
  // so it's set while the field is briefly a text one.
  useEffect(() => {
    const t = setTimeout(() => {
      const input = focusInput.current;
      if (!input) return;
      input.focus();
      try {
        const end = input.value.length;
        input.type = "text";
        input.setSelectionRange(end, end);
      } catch {
        // Leave the browser's own cursor placement.
      } finally {
        input.type = "number";
      }
    }, 0);
    return () => {
      clearTimeout(t);
      clearTimeout(flashTimer.current);
    };
  }, []);

  // Apply new values: show them, flash the ones that moved without being
  // typed, and announce those.
  const commit = (next: number[], typed: number | null) => {
    const moved = next
      .map((v, i) => i)
      .filter((i) => i !== typed && next[i] !== values[i]);
    setValues(next);
    setTexts(next.map(toText));
    if (moved.length) {
      setFlashing(new Set(moved));
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashing(new Set()), FLASH_MS);
      setAnnouncement(
        `Adjusted to keep the total at 100%: ${moved
          .map((i) => `${variations[i].name} ${next[i]}%`)
          .join(", ")}.`,
      );
    }
    return next;
  };

  const normalizeField = (i: number): number[] =>
    commit(normalizeSplit(values, i, parseFloat(texts[i])), i);

  // Modal.Root's close, which plays the fade-out first, for the form's
  // submit (defined out here, outside the modal's context).
  const requestCloseRef = useRef<(() => void) | null>(null);

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // The standard small modal: rows grow its height, not its width, and
      // its body scrolls when there are many.
      size="md"
      // Escape and a click outside cancel, as Cancel does.
      dismissible
      // No description under the title (removed in review); the rule is
      // in the fields' hidden description.
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
          // A field still focused is normalised first, then applied.
          const final = focused !== null ? normalizeField(focused) : values;
          onConfirm(final.map((v) => v / 100));
          // Through Modal.Root, so the fade-out plays first.
          (requestCloseRef.current ?? close)();
        }}
      >
        {/* As the Create Experiment modal's header (set in review): a
          divider under it, the title as a page heading, and a close button
          at its right, with no height of its own so the trimmed title sets
          the header's height. FALLBACK: Radix IconButton; @/ui/ has no icon
          button. */}
        <Modal.Header divider>
          <Modal.Title pageHeading>Edit Split %</Modal.Title>
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
        {/* Scrolls right up to the header's and footer's dividers. */}
        <Modal.Body scrollToEdges>
          {/* The fields' hover and focus as the Setup page's and the
            experiments list's search field's (set in review; see .fields),
            the headers as the list's column headers and the names in
            --color-text-high (listStyle). */}
          <div className={styles.fields}>
            <VariationSplitTable
              variations={variations}
              listStyle
              splitHeaderAction={
                // A 12px link button (@/ui/Link with onClick renders a
                // <button type="button">, so it doesn't submit), as Reset to
                // Defaults in Statistics. Shown only once the split is no
                // longer even (set in review; it was a footer button).
                !isEven ? (
                  <Link
                    size="sm"
                    onClick={() => commit(evenSplit(variations.length), null)}
                  >
                    Split Even
                  </Link>
                ) : null
              }
              renderSplit={(v, i) => (
                <TextField
                  ref={i === focusIndex ? focusInput : undefined}
                  id={`split-${v.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.1}
                  value={texts[i]}
                  aria-labelledby={`split-label-${v.id}`}
                  aria-describedby="split-total-rule"
                  style={{ width: SPLIT_COLUMN_PX }}
                  containerClassName={
                    flashing.has(i) ? styles.flash : undefined
                  }
                  onFocus={() => setFocused(i)}
                  onChange={(e) => {
                    // One decimal place at most; free otherwise until blur.
                    const t = e.target.value;
                    if (/^\d*\.?\d?$/.test(t)) {
                      setTexts((prev) => prev.map((x, j) => (j === i ? t : x)));
                    }
                  }}
                  onBlur={() => {
                    setFocused(null);
                    normalizeField(i);
                  }}
                />
              )}
            />
          </div>
          {/* Visually hidden: the rule (the splits add up to 100%) for the
            fields' descriptions, and the polite announcement of moved
            values. */}
          <span id="split-total-rule" className="sr-only">
            The splits always add up to 100%. Changing one adjusts the others.
          </span>
          <div aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </Modal.Body>
        <Modal.Footer flushTop>
          {/* As the Create Experiment modal's Cancel (set in review): grey,
            --slate-12 text at 400, 6px corners on its hover fill. It closes
            through Modal.Close, so the fade-out plays; @/ui/Button's default
            preventDefault would cancel that click. */}
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
