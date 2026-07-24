import { ReactNode, useEffect, useRef, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimpleFill } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Markdown from "@/components/Markdown/Markdown";
import CommentComposer from "@/components/Comments/CommentComposer";

const NOTES_MAX_COLLAPSED_HEIGHT = 200;

// Shared revision-description section, cloned from the feature flow's
// RevisionCommentItem (components/Reviews/Feature/RevisionDiffUtils.tsx): a
// titled card with the description rendered as Markdown, a "Show more/less"
// overflow control, and — when editable — an inline pencil that swaps the body
// for a CommentComposer. The feature original is coupled to a feature log fetch
// (for editor attribution) and the feature comment endpoint, so this is a clone
// with persistence parameterized via `onEdit`; the feature side stays untouched
// and adopts this later.
export default function RevisionDescription({
  description,
  heading = "Revision description",
  canEdit = false,
  onEdit,
  editorMeta,
  label,
}: {
  description?: string | null;
  heading?: string;
  // The viewer may edit the description (an inline pencil appears when an
  // `onEdit` handler is also supplied).
  canEdit?: boolean;
  // Persists an edited description. The entity owns the endpoint + any refetch.
  onEdit?: (value: string) => Promise<void>;
  // Optional attribution rendered on the right of the header (e.g. who last
  // edited it + when). Omitted by entities that don't track it.
  editorMeta?: ReactNode;
  // Optional label rendered after the heading (e.g. a version label when
  // comparing multiple revisions).
  label?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  // Optimistic value so the saved description shows immediately (the parent's
  // `description` stays stale until it re-fetches).
  const [localComment, setLocalComment] = useState<string | null>(null);
  const comment = localComment ?? description ?? "";

  const canEditNotes = canEdit && !!onEdit;

  // ── Size-aware overflow controls for the read-only body ──
  // Show a "Show more"/"Show less" toggle only when the rendered Markdown
  // exceeds NOTES_MAX_COLLAPSED_HEIGHT. ResizeObserver re-checks when the
  // content height changes (e.g. images load, viewport changes).
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notesOverflow, setNotesOverflow] = useState(false);
  const notesContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = notesContentRef.current;
    if (!el) return;
    const check = () => {
      setNotesOverflow(el.scrollHeight > NOTES_MAX_COLLAPSED_HEIGHT + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comment, editing]);

  // Read-only surfaces with no description render nothing (no empty box).
  if (!comment && !canEditNotes) return null;

  return (
    <Box mb="5" className="appbox">
      <Flex
        align="center"
        gap="2"
        wrap="wrap"
        px="4"
        py="2"
        style={{ borderBottom: "1px solid var(--gray-a4)", minHeight: 40 }}
      >
        <Flex align="center" gap="2">
          <Heading as="h5" size="small" color="text-mid" mb="0">
            {heading}
          </Heading>
          {canEditNotes && !editing && (
            <IconButton
              variant="ghost"
              color="violet"
              size="2"
              radius="full"
              mx="1"
              onClick={() => setEditing(true)}
              aria-label="Edit description"
            >
              <PiPencilSimpleFill />
            </IconButton>
          )}
        </Flex>
        {label}
        {editorMeta && (
          <Flex
            align="center"
            gap="1"
            wrap="wrap"
            ml={{ initial: "0", sm: "auto" }}
            style={{ minWidth: 0 }}
          >
            {editorMeta}
          </Flex>
        )}
      </Flex>

      <Box p="4">
        {editing && onEdit ? (
          <CommentComposer
            cta="Save"
            placeholder="Describe this revision..."
            initialValue={comment}
            autofocus
            onCancel={() => setEditing(false)}
            onSubmit={async (next) => {
              await onEdit(next);
              setLocalComment(next);
              setEditing(false);
            }}
          />
        ) : comment ? (
          <>
            <Box
              style={
                !notesExpanded && notesOverflow
                  ? {
                      position: "relative",
                      maxHeight: NOTES_MAX_COLLAPSED_HEIGHT,
                      overflow: "hidden",
                    }
                  : { position: "relative" }
              }
            >
              <Box ref={notesContentRef}>
                <Markdown className="speech-bubble" highlightCode>
                  {comment}
                </Markdown>
              </Box>
              {!notesExpanded && notesOverflow && (
                <Box
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 64,
                    background:
                      "linear-gradient(transparent, var(--color-panel-solid))",
                    pointerEvents: "none",
                  }}
                />
              )}
            </Box>
            {notesOverflow && (
              <Box mt="2">
                <Link onClick={() => setNotesExpanded((v) => !v)}>
                  {notesExpanded ? "Show less" : "Show more"}
                </Link>
              </Box>
            )}
          </>
        ) : (
          <Text size="medium" as="div" color="text-low" fontStyle="italic">
            No description yet.
          </Text>
        )}
      </Box>
    </Box>
  );
}
