import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownFill, PiPlus } from "react-icons/pi";
import {
  DATA_TYPE_LABELS,
  ManagedValueDataType,
} from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import { Select, SelectItem } from "@/ui/Select";
import TextField from "@/ui/TextField";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { EditButton, SetupLabel, ValueDot } from "./SetupFunnel";
import styles from "./SetupFunnel.module.scss";

// The Values type's inline editing, per the design: a Values row below the
// variation cards with one field per variation, and an Environments row above
// Targeting. Prototype-only; everything here edits front-end state (see
// ManagedValuesContext.tsx).
//
// Values are edited here and nowhere else. The Edit Traffic modal deliberately
// has no values column: getting a modal from "add values" was the confusion
// this row replaces, and two paths to one field would reinstate it.

// @/ui/Select's checkmark: Radix Themes' ThickCheckIcon, which it doesn't
// export, redrawn from the same path, at the 10px Select uses.
function SelectCheck() {
  return (
    <svg width="10" height="10" viewBox="0 0 9 9" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.53547 0.62293C8.88226 0.849446 8.97976 1.3142 8.75325 1.66099L4.5083 8.1599C4.38833 8.34356 4.19397 8.4655 3.9764 8.49358C3.75883 8.52167 3.53987 8.45309 3.3772 8.30591L0.616113 5.80777C0.308959 5.52987 0.285246 5.05559 0.563148 4.74844C0.84105 4.44128 1.31533 4.41757 1.62249 4.69547L3.73256 6.60459L7.49741 0.840706C7.72393 0.493916 8.18868 0.396414 8.53547 0.62293Z"
      />
    </svg>
  );
}

// "Values" on the left, the value type on the right, as the design lays out.
// "Values" is the same as "Split %" (12px semibold, main text colour), and
// there's no missing-values warning beside it (both set in review); the To
// Do list's "Set Variation Values" covers that.
export function ValuesRowHeader({
  dataType,
  setDataType,
  editable,
}: {
  dataType: ManagedValueDataType;
  setDataType: (t: ManagedValueDataType) => void;
  editable: boolean;
}) {
  return (
    <Flex justify="between" align="center" gap="3">
      <Text size="sm" weight="semibold">
        Values
      </Text>
      <Flex align="center" gap="2">
        <SetupLabel>Type</SetupLabel>
        {editable ? (
          // The Results tab's dimension picker pattern (DimensionChooser):
          // the current value as a link with a filled caret, opening a soft
          // DropdownMenu (set in review). At 12px, like the "Type" label,
          // where the Results tab's is 14px.
          <DropdownMenu
            trigger={
              // --gray-12, the same as the section headings, and 1px up (both
              // set in review).
              <Link
                type="button"
                style={{
                  color: "var(--gray-12)",
                  position: "relative",
                  top: -1,
                }}
              >
                <Text size="sm" mr="1">
                  {DATA_TYPE_LABELS[dataType]}
                </Text>
                <PiCaretDownFill style={{ fontSize: "12px" }} />
              </Link>
            }
            menuPlacement="end"
            variant="soft"
            // 180px wide (set in review).
            menuWidth={180}
            // The toast's shadow, being tried here (set in review).
            contentClassName={styles.softMenuShadow}
          >
            {(Object.keys(DATA_TYPE_LABELS) as ManagedValueDataType[]).map(
              (t) => (
                // A check by the current type, laid out like @/ui/Select's
                // menu (set in review; see .checkItem).
                <DropdownMenuItem
                  key={t}
                  className={`${styles.checkItem}${
                    t === dataType ? ` ${styles.checkItemSelected}` : ""
                  }`}
                  onClick={() => setDataType(t)}
                >
                  {t === dataType ? (
                    <span className={styles.checkIndicator} aria-hidden>
                      <SelectCheck />
                    </span>
                  ) : null}
                  {DATA_TYPE_LABELS[t]}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenu>
        ) : (
          <Text size="sm">{DATA_TYPE_LABELS[dataType]}</Text>
        )}
      </Flex>
    </Flex>
  );
}

const PLACEHOLDERS: Record<ManagedValueDataType, string> = {
  string: "Enter a string...",
  number: "Enter a number...",
  boolean: "",
  json: '{"key": "value"}',
};

// The JSON modal's Apply: a submit button that shows the form's progress,
// as ModalStandard's does.
// label: the button's text (e.g. "Confirm"); "Apply" by default.
export function ApplyButton({ label = "Apply" }: { label?: string }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" loading={loading}>
      {label}
    </Button>
  );
}

// A JSON value (set in review): shown read-only, two lines tall, with a
// pencil on the right that opens a large modal to edit it (Cancel / Apply).
// Applying shows a two-line preview here. Invalid JSON can't be applied.
function JsonValueField({
  value,
  onChange,
  variationName,
  variationIndex,
}: {
  value: string;
  onChange: (v: string) => void;
  variationName: string;
  variationIndex: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Lines to fill the "full" modal (the window's height less its 148px
  // margin), at about 16px a line; worked out when it opens.
  const [editorLines, setEditorLines] = useState(30);
  const openEditor = () => {
    setDraft(value);
    setEditorLines(Math.ceil((window.innerHeight - 148) / 16));
    setEditing(true);
  };
  // The preview: the JSON on as few lines as it fits (compact), or as typed
  // if it isn't valid JSON (a value kept from another type).
  let preview = value;
  try {
    if (value.trim()) preview = JSON.stringify(JSON.parse(value));
  } catch {
    preview = value;
  }

  return (
    <>
      {editing ? (
        // Built from @/ui/Modal's parts rather than ModalStandard: its body
        // and footer drop their spacing (flushBottom / flushTop) so the
        // editor runs right up to the footer (set in review).
        <Modal.Root
          open
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
          size="full"
          dismissible={false}
          hasDescription
          trackingEventModalType=""
        >
          <ModalForm
            onSubmit={async () => {
              if (draft.trim()) {
                try {
                  JSON.parse(draft);
                } catch {
                  throw new Error("That isn't valid JSON.");
                }
              }
              onChange(draft.trim() ? draft : "");
              setEditing(false);
            }}
          >
            <Modal.Header>
              <Modal.Title>Edit Value</Modal.Title>
            </Modal.Header>
            {/* The variation on its own line, 14px, with its coloured dot,
              the same indicator the Values row uses, 2px under the title
              (set in review). Spans only: it sits inside the description
              paragraph. */}
            <Modal.Description>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  fontSize: "var(--font-size-2)",
                  lineHeight: "var(--line-height-2)",
                  marginTop: "-2px",
                }}
              >
                <ValueDot index={variationIndex} />
                {variationName}
              </span>
            </Modal.Description>
            <Modal.Body flushBottom>
              {/* FALLBACK: the legacy components/Forms/CodeTextArea (Ace, with
              JSON highlighting); @/ui/ has no code editor. */}
              <CodeTextArea
                language="json"
                // No form-group margin under it, so it reaches the footer.
                containerClassName="mb-0"
                value={draft}
                setValue={setDraft}
                placeholder='{"key": "value"}'
                // Taller than the window's content area from the start, so the
                // editor runs past the footer and the window scrolls, rather
                // than leaving a short box (set in review): as many lines as
                // the whole window is tall, then growing with the content.
                minLines={editorLines}
                maxLines={editorLines + 500}
              />
              {/* 48px after the editor, so scrolled to the end it stops
                short of the footer (set in review). */}
              <Box style={{ height: 48 }} aria-hidden />
            </Modal.Body>
            <Modal.Footer flushTop>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <ApplyButton />
            </Modal.Footer>
          </ModalForm>
        </Modal.Root>
      ) : null}
      {/* Clicking anywhere on the field opens the editor, as its empty text
        says; the pencil is the same action for the keyboard. */}
      <div className={styles.jsonField} onClick={openEditor}>
        <span className={styles.jsonDot}>
          <ValueDot index={variationIndex} />
        </span>
        <span
          className={`${styles.jsonPreview} ${
            value.trim() ? "" : styles.jsonPlaceholder
          }`}
          title={value.trim() ? preview : undefined}
        >
          {value.trim() ? preview : "Click to edit JSON"}
        </span>
        <span className={styles.jsonEdit}>
          <EditButton
            label={`Edit value for ${variationName}`}
            onClick={openEditor}
          />
        </span>
      </div>
    </>
  );
}

// One variation's value. Stored as a string whatever the type, like the
// source prototype; a type switch keeps what's typed rather than guessing a
// conversion.
export function ValueInput({
  dataType,
  value,
  onChange,
  editable,
  variationName,
  variationIndex,
}: {
  dataType: ManagedValueDataType;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  variationName: string;
  // For the coloured dot at the start of the field, as in the design.
  variationIndex: number;
}) {
  // Read-only (e.g. running): the field's box stays, so the card keeps its
  // shape, but with no fill and no caret, and nothing to click (set in
  // review). The lighter outline is the read-only JSON field's.
  if (!editable) {
    if (dataType === "json") {
      return (
        <div
          className={`${styles.jsonField} ${styles.readOnlyField}`}
          aria-label={`Value for ${variationName}`}
        >
          <span className={styles.jsonDot}>
            <ValueDot index={variationIndex} />
          </span>
          <span className={styles.jsonPreview}>
            {value || <span className={styles.readOnlyEmpty}>--</span>}
          </span>
        </div>
      );
    }
    return (
      <div
        className={`${styles.readOnlyValue} ${styles.readOnlyField}`}
        aria-label={`Value for ${variationName}`}
      >
        <ValueDot index={variationIndex} />
        {value ? (
          <span className={styles.readOnlyText}>
            {/* True/False in title case, as in the select. */}
            {dataType === "boolean" && (value === "true" || value === "false")
              ? value === "true"
                ? "True"
                : "False"
              : value}
          </span>
        ) : (
          <span className={styles.readOnlyEmpty}>--</span>
        )}
      </div>
    );
  }
  if (dataType === "json") {
    return (
      <JsonValueField
        value={value}
        onChange={onChange}
        variationName={variationName}
        variationIndex={variationIndex}
      />
    );
  }
  if (dataType === "boolean") {
    // Only "true" or "false" count as chosen. Anything else (text kept from
    // another type, since a type switch keeps what's typed) shows as
    // unchosen, with the placeholder, rather than a blank select (fixed in
    // review).
    const chosen = value === "true" || value === "false" ? value : undefined;
    return (
      // The coloured dot drawn over the select's left edge, where the text
      // fields have theirs (set in review); the select's text is inset to
      // clear it (.selectWithDot).
      <Box style={{ position: "relative" }}>
        <Select
          value={chosen}
          setValue={onChange}
          triggerClassName={`${styles.valueField} ${styles.selectWithDot}`}
          placeholder="Select..."
          style={{ width: "100%" }}
        >
          {/* Title case for display (set in review); the stored values
            stay "true" and "false". */}
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </Select>
        <span className={styles.selectDot}>
          <ValueDot index={variationIndex} />
        </span>
      </Box>
    );
  }
  return (
    <TextField
      type={dataType === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={PLACEHOLDERS[dataType]}
      aria-label={`Value for ${variationName}`}
      className={styles.valueField}
      // 4px more room left of the dot, on top of the field's own 8px
      // padding (set in review).
      prepend={
        <span style={{ display: "inline-flex", marginLeft: 4 }}>
          <ValueDot index={variationIndex} />
        </span>
      }
    />
  );
}

// The Values type's Environments row, above Targeting. Only the environments
// the experiment is enabled in are listed. No approval gating: this is the
// picker and the stored selection only.
export function EnvironmentsRow({
  environments,
  onEdit,
}: {
  environments: string[];
  onEdit?: () => void;
}) {
  return (
    // The pencil shows on hover (see .hoverRow).
    <Flex
      align="center"
      justify="center"
      gap="3"
      wrap="wrap"
      // 12px here plus the row's 4px bottom padding: the same 16px to the
      // Targeting card as before.
      mb={onEdit && environments.length ? "3" : "4"}
      className={onEdit && environments.length ? styles.hoverRow : undefined}
    >
      {/* The cards' title style (semibold, main text colour, not an
        uppercase eyebrow) at 12px, set in review. */}
      <Text size="sm" weight="semibold">
        Environments
      </Text>
      {environments.length ? (
        <Flex gap="2" wrap="wrap">
          {environments.map((envId) => (
            // Our neutral badge (gray, soft), set in review.
            <Badge key={envId} label={envId} color="gray" variant="soft" />
          ))}
        </Flex>
      ) : onEdit ? null : (
        <Text size="sm" color="text-low">
          --
        </Text>
      )}
      {onEdit ? (
        environments.length ? (
          <EditButton onClick={onEdit} label="Edit environments" />
        ) : (
          <Button size="sm" variant="ghost" icon={<PiPlus />} onClick={onEdit}>
            Add Environments
          </Button>
        )
      ) : null}
    </Flex>
  );
}
