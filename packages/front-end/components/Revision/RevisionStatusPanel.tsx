import React, { ReactNode, useEffect, useRef, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import {
  PiPencil,
  PiProhibit,
  PiLockSimple,
  PiPencilSimpleFill,
  PiCaretRightFill,
} from "react-icons/pi";
import { Revision } from "shared/enterprise";
import { ago, datetime } from "shared/dates";
import Frame from "@/ui/Frame";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import EventUser from "@/components/Avatar/EventUser";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import { getStatusBadge } from "./revisionUtils";

function CoAuthorsFromIds({
  authorId,
  contributorIds,
}: {
  authorId: string;
  contributorIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = contributorIds.filter((id) => id !== authorId);
  if (filtered.length === 0) return null;
  const label = `Co-author${filtered.length > 1 ? "s" : ""} (${filtered.length})`;
  return (
    <Box mt="3" mb="3">
      <div
        className="link-purple"
        style={{
          cursor: "pointer",
          userSelect: "none",
          display: "inline-block",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <PiCaretRightFill
          style={{
            display: "inline",
            marginRight: 4,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        {label}
      </div>
      {open && (
        <Flex direction="column" gap="2" mt="2" ml="3">
          {filtered.map((id) => (
            <EventUser
              key={id}
              user={{ type: "dashboard", id, name: "", email: "" }}
              display="avatar-name-email"
              size="sm"
              wrap={true}
            />
          ))}
        </Flex>
      )}
    </Box>
  );
}

export interface RevisionStatusPanelProps {
  // Used in the "This <entityNoun> has N draft revisions" banner copy.
  entityNoun: string;
  allRevisions: Revision[];
  selectedRevision: Revision | null;
  // The revision whose metadata/title is shown (selected, or latest merged for
  // the live view).
  displayRevision?: Revision;
  revisionNumber: number;
  metadataReviewRequired: boolean;
  currentUserId?: string;
  // Author / created date shown when the entity has no real revisions yet.
  fallbackAuthorId: string;
  fallbackCreatedDate: Date | string;
  selectFlow: (revision: Revision | null) => void;
  onSaveTitle: (title: string) => Promise<void> | void;
  // Rendered in the left header row after the title (e.g. a "Compare
  // revisions" button); the vertical separator is added automatically.
  titleRowExtra?: ReactNode;
  // Right-aligned action buttons (Discard / Reopen / Review & Publish / etc.).
  actions?: ReactNode;
}

/**
 * Shared revision header used by entity detail pages (Saved Groups, SDK
 * Connections). Renders the sticky status banner plus a frame showing the
 * selected revision's number/title/status, action buttons, and author/date
 * metadata. Entity-specific actions are passed via the `actions` slot so the
 * visual frame stays identical across entities.
 */
export default function RevisionStatusPanel({
  entityNoun,
  allRevisions,
  selectedRevision,
  displayRevision,
  revisionNumber,
  metadataReviewRequired,
  currentUserId,
  fallbackAuthorId,
  fallbackCreatedDate,
  selectFlow,
  onSaveTitle,
  titleRowExtra,
  actions,
}: RevisionStatusPanelProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerPinned, setBannerPinned] = useState(false);
  const { scrollY } = useScrollPosition();

  useEffect(() => {
    if (!bannerRef.current) return;
    setBannerPinned(bannerRef.current.getBoundingClientRect().top <= 110);
  }, [scrollY]);

  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(selectedRevision?.title || "");
  }, [selectedRevision?.id, selectedRevision?.title]);

  const isLive = !selectedRevision;
  const isDraft =
    selectedRevision &&
    (selectedRevision.status === "draft" ||
      selectedRevision.status === "pending-review" ||
      selectedRevision.status === "changes-requested" ||
      selectedRevision.status === "approved");
  const isDiscarded =
    selectedRevision && selectedRevision.status === "discarded";
  const isMerged = selectedRevision && selectedRevision.status === "merged";
  const hasRevisions = allRevisions.length > 0;

  const commitTitleEdit = async () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== (selectedRevision?.title ?? "")) {
      await onSaveTitle(next);
    }
  };

  const bannerProps = isDraft
    ? {
        icon: <PiPencil size={18} />,
        color: "var(--amber-11)",
        bgColor: "var(--amber-a3)",
        message: (
          <>
            Viewing a <strong>draft</strong> — changes will not go live until
            published
          </>
        ),
      }
    : metadataReviewRequired && isDiscarded
      ? {
          icon: <PiProhibit size={18} />,
          color: "var(--gray-11)",
          bgColor: "var(--gray-a3)",
          message: (
            <>
              Viewing a <strong>discarded</strong> revision — this was never
              published
            </>
          ),
        }
      : metadataReviewRequired && isMerged
        ? {
            icon: <PiLockSimple size={18} />,
            color: "var(--gray-11)",
            bgColor: "var(--gray-a3)",
            message: (
              <>
                Viewing a previously <strong>published</strong> revision.{" "}
                <span
                  style={{
                    cursor: "pointer",
                    color: "var(--accent-11)",
                    fontWeight: 600,
                    textUnderlineOffset: 2,
                  }}
                  onClick={() => selectFlow(null)}
                >
                  Switch to live
                </span>
              </>
            ),
          }
        : isLive
          ? (() => {
              const activeDrafts = allRevisions.filter(
                (r) =>
                  r.status === "draft" ||
                  r.status === "approved" ||
                  r.status === "changes-requested" ||
                  r.status === "pending-review",
              );
              if (activeDrafts.length === 0) return null;
              return {
                icon: <PiPencil size={18} />,
                color: "var(--gray-11)",
                bgColor: "var(--gray-a3)",
                message: (
                  <>
                    This {entityNoun} has{" "}
                    <strong>
                      {activeDrafts.length === 1
                        ? "a draft revision"
                        : `${activeDrafts.length} draft revisions`}
                    </strong>
                    {activeDrafts.length === 1 && (
                      <>
                        {". "}
                        <span
                          style={{
                            cursor: "pointer",
                            color: "var(--accent-11)",
                            fontWeight: 600,
                            textUnderlineOffset: 2,
                          }}
                          onClick={() => selectFlow(activeDrafts[0])}
                        >
                          Switch to draft
                        </span>
                      </>
                    )}
                  </>
                ),
              };
            })()
          : null;

  return (
    <>
      {bannerProps && (
        <div
          ref={bannerRef}
          style={{
            position: "sticky",
            top: 110,
            zIndex: 920,
            marginBottom: 12,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              backgroundColor: "var(--color-background)",
              borderRadius: "var(--radius-3)",
              overflow: "hidden",
              maxWidth: bannerPinned ? "580px" : "2000px",
              boxShadow: bannerPinned ? "var(--shadow-3)" : undefined,
              transition: "all 200ms ease",
              pointerEvents: "auto",
            }}
          >
            <Flex
              align="center"
              justify="center"
              gap="2"
              px="4"
              py="3"
              style={{
                color: bannerProps.color,
                backgroundColor: bannerProps.bgColor,
              }}
            >
              {bannerProps.icon}
              <span style={{ fontSize: "var(--font-size-2)" }}>
                {bannerProps.message}
              </span>
            </Flex>
          </div>
        </div>
      )}
      <Frame mt="2" mb="4" px="6" py="4">
        <Flex align="start" justify="between" mb="2" wrap="wrap" gap="2">
          <Flex align="start" gap="4" style={{ marginTop: 5 }}>
            <Flex direction="column" gap="1">
              {hasRevisions && (
                <Flex align="center" gap="2">
                  {displayRevision?.title && (
                    <span
                      style={{
                        display: "inline-block",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      <Text as="span" color="text-mid" size="medium">
                        {revisionNumber}.
                      </Text>
                    </span>
                  )}
                  {editingTitle ? (
                    <Field
                      autoFocus
                      value={titleDraft}
                      placeholder={`Revision ${revisionNumber}`}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          await commitTitleEdit();
                        } else if (e.key === "Escape") {
                          setEditingTitle(false);
                          setTitleDraft(selectedRevision?.title || "");
                        }
                      }}
                      onBlur={commitTitleEdit}
                      containerStyle={{ maxWidth: 250, marginBottom: 0 }}
                      style={{
                        border: "none",
                        borderBottom: "1px solid var(--violet-9)",
                        borderCollapse: "collapse",
                        borderRadius: 0,
                        outline: "none",
                        background: "transparent",
                        boxShadow: "none",
                        padding: "0 2px",
                        height: "auto",
                        fontSize: "var(--font-size-3)",
                        fontWeight: 700,
                      }}
                    />
                  ) : (
                    <Text weight="semibold" size="large">
                      <OverflowText
                        maxWidth={250}
                        title={
                          displayRevision?.title || `Revision ${revisionNumber}`
                        }
                      >
                        {displayRevision?.title || `Revision ${revisionNumber}`}
                      </OverflowText>
                    </Text>
                  )}
                  {isDraft &&
                    selectedRevision?.authorId === currentUserId &&
                    !editingTitle && (
                      <IconButton
                        variant="ghost"
                        color="violet"
                        size="2"
                        radius="full"
                        onClick={() => {
                          setTitleDraft(selectedRevision?.title || "");
                          setEditingTitle(true);
                        }}
                        mx="1"
                      >
                        <PiPencilSimpleFill />
                      </IconButton>
                    )}
                  <Box flexShrink="0">
                    {getStatusBadge(
                      isLive ? "live" : (selectedRevision?.status ?? "draft"),
                    )}
                  </Box>
                </Flex>
              )}
            </Flex>
            {hasRevisions && allRevisions.length >= 2 && titleRowExtra && (
              <>
                <Separator orientation="vertical" style={{ marginTop: 2 }} />
                {titleRowExtra}
              </>
            )}
          </Flex>
          <Flex align="center" justify="end" gap="4" flexGrow="1">
            {actions}
          </Flex>
        </Flex>
        <Separator size="4" my="3" />
        <Flex direction="column">
          <Flex
            align="center"
            justify="between"
            wrap="wrap"
            style={{
              rowGap: "var(--space-1)",
              columnGap: "var(--space-4)",
            }}
          >
            <Metadata
              label={hasRevisions ? "Revised by" : "Created by"}
              value={
                <EventUser
                  user={{
                    type: "dashboard",
                    id:
                      hasRevisions && displayRevision
                        ? displayRevision.authorId
                        : fallbackAuthorId,
                    name: "",
                    email: "",
                  }}
                  display="avatar-name-email"
                  size="sm"
                />
              }
            />
            <Flex align="center" gap="4" wrap="wrap">
              <Metadata
                label="Created"
                value={datetime(
                  hasRevisions && displayRevision
                    ? displayRevision.dateCreated
                    : fallbackCreatedDate,
                )}
              />
              {hasRevisions &&
                (isLive || isMerged) &&
                displayRevision?.resolution?.dateCreated && (
                  <Metadata
                    label="Published"
                    value={datetime(displayRevision.resolution.dateCreated)}
                  />
                )}
              {hasRevisions && isDraft && displayRevision && (
                <Metadata
                  label="Last update"
                  value={ago(displayRevision.dateUpdated)}
                />
              )}
            </Flex>
          </Flex>
          {hasRevisions &&
            displayRevision &&
            (() => {
              const coAuthorIds = (displayRevision.contributors ?? []).filter(
                (id) => id !== displayRevision.authorId,
              );
              if (coAuthorIds.length === 0) return null;
              return (
                <CoAuthorsFromIds
                  authorId={displayRevision.authorId}
                  contributorIds={coAuthorIds}
                />
              );
            })()}
        </Flex>
      </Frame>
    </>
  );
}
