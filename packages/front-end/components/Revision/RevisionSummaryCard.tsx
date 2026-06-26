import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Revision,
  isScheduledPublishPending,
  isScheduledPublishLockActive,
} from "shared/enterprise";
import { datetime, ago } from "shared/dates";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import {
  PiPencil,
  PiProhibit,
  PiLockSimple,
  PiClockFill,
  PiPencilSimpleFill,
  PiArrowRightBold,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import CoAuthorsList from "@/components/Reviews/CoAuthorsList";
import InlineRevisionDescription from "@/components/Reviews/InlineRevisionDescription";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import Field from "@/components/Forms/Field";
import Metadata from "@/ui/Metadata";
import EventUser from "@/components/Avatar/EventUser";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import { useUser } from "@/services/UserContext";

const DRAFT_STATUSES = ["draft", "pending-review", "changes-requested"];

export interface RevisionSummaryCardProps {
  allRevisions: Revision[];
  // The revision currently in view; null when viewing the live state.
  selectedRevision: Revision | null;
  // Singular entity noun for banner copy, e.g. "saved group" / "constant".
  entityNoun: string;
  hasRevisions: boolean;
  // Whether the viewer may edit a draft revision's title/description. Gated by
  // the entity's update permission (NOT by draft authorship); `isDraft` still
  // applies so only drafts are editable.
  canEditTitle: boolean;
  canEditDescription: boolean;
  // Used for the "Created by" / "Created" fields before any real revision exists.
  fallbackOwnerId: string;
  fallbackDateCreated: Date;
  onSelectRevision: (revision: Revision | null) => void;
  onTitleCommit: (revisionId: string, title: string) => Promise<void>;
  // Each action is optional; the corresponding control is hidden when omitted.
  onNewDraft?: () => void;
  onReviewPublish?: () => void;
  onEditDescription?: () => void;
}

// Shared revision header used by every revisioned entity's detail page: the
// sticky draft banner plus the summary card (title + inline rename, status
// badge, compare, and the publish/discard/revert/new-draft actions). All
// entity-specific behaviour is wired through callbacks.
export default function RevisionSummaryCard({
  allRevisions,
  selectedRevision,
  entityNoun,
  hasRevisions,
  canEditTitle: canEditTitleProp,
  canEditDescription: canEditDescriptionProp,
  fallbackOwnerId,
  fallbackDateCreated,
  onSelectRevision,
  onTitleCommit,
  onNewDraft,
  onReviewPublish,
  onEditDescription,
}: RevisionSummaryCardProps) {
  const { getOwnerDisplay } = useUser();
  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerPinned, setBannerPinned] = useState(false);
  const { scrollY } = useScrollPosition();
  useEffect(() => {
    if (!bannerRef.current) return;
    setBannerPinned(bannerRef.current.getBoundingClientRect().top <= 110);
  }, [scrollY]);

  const isLive = !selectedRevision;
  const status = selectedRevision?.status;
  const isDraft =
    !!status && (DRAFT_STATUSES.includes(status) || status === "approved");
  const isMerged = status === "merged";
  const isDiscarded = status === "discarded";

  const liveRevision = useMemo(
    () =>
      [...allRevisions]
        .filter((r) => r.status === "merged")
        .sort(
          (a, b) =>
            new Date(b.dateUpdated).getTime() -
            new Date(a.dateUpdated).getTime(),
        )[0],
    [allRevisions],
  );
  const displayRevision = selectedRevision ?? liveRevision;

  const revisionNumber = useMemo(() => {
    const sorted = [...allRevisions].sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
    if (displayRevision?.version) return displayRevision.version;
    if (displayRevision) {
      return sorted.findIndex((f) => f.id === displayRevision.id) + 1;
    }
    return sorted.length;
  }, [allRevisions, displayRevision]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(selectedRevision?.title || "");
  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(selectedRevision?.title || "");
  }, [selectedRevision?.id, selectedRevision?.title]);

  const commitTitleEdit = async () => {
    if (!selectedRevision) return;
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== (selectedRevision.title ?? "")) {
      await onTitleCommit(selectedRevision.id, next);
    }
  };

  const canEditTitle = isDraft && canEditTitleProp;

  const activeDrafts = useMemo(
    () =>
      allRevisions.filter(
        (r) =>
          r.status === "draft" ||
          r.status === "approved" ||
          r.status === "changes-requested" ||
          r.status === "pending-review",
      ),
    [allRevisions],
  );

  const isPendingReview =
    status === "pending-review" || status === "changes-requested";
  const scheduledPublishPending =
    !!selectedRevision && isScheduledPublishPending(selectedRevision);

  const bannerProps = isDraft
    ? scheduledPublishPending && selectedRevision
      ? (() => {
          // Mirrors a ramp lockdown, naming the target date. Locks engage only
          // once approved; while in review we say "once approved" and omit the
          // lock clauses (editing stays open).
          const lockActive = isScheduledPublishLockActive(selectedRevision);
          const awaitingApproval = isPendingReview;
          const lockEditsActive =
            lockActive && !!selectedRevision.scheduledPublishLockEdits;
          const lockOthersActive =
            lockActive && !!selectedRevision.scheduledPublishLockOthers;
          const lockClauses = [
            lockEditsActive ? "edits are locked" : null,
            lockOthersActive ? "publishing other drafts is locked" : null,
          ].filter((c): c is string => c !== null);
          return {
            icon: lockClauses.length ? (
              <PiLockSimple size={18} />
            ) : (
              <PiClockFill size={18} />
            ),
            color: "var(--amber-11)",
            bgColor: "var(--amber-a3)",
            message: (
              <>
                This <strong>draft</strong> is scheduled to publish on{" "}
                <strong>
                  {datetime(selectedRevision.scheduledPublishAt as Date)}
                </strong>
                {awaitingApproval ? " once approved" : ""}
                {lockClauses.length ? ` — ${lockClauses.join(" and ")}` : ""}
              </>
            ),
          };
        })()
      : {
          icon: <PiPencil size={18} />,
          color: "var(--amber-11)",
          bgColor: "var(--amber-a3)",
          message: (
            <>
              Viewing a <strong>draft</strong> —{" "}
              {isPendingReview
                ? "changes will not go live until approved and published"
                : "changes will not go live until published"}
            </>
          ),
        }
    : isDiscarded
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
      : isMerged
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
                  onClick={() => onSelectRevision(null)}
                >
                  Switch to live
                </span>
              </>
            ),
          }
        : isLive && activeDrafts.length > 0
          ? {
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
                        onClick={() => onSelectRevision(activeDrafts[0])}
                      >
                        Switch to draft
                      </span>
                    </>
                  )}
                </>
              ),
            }
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
              <span style={{ display: "flex", flexGrow: 0, flexShrink: 0 }}>
                {bannerProps.icon}
              </span>
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
                        title={revisionLabelText(
                          revisionNumber,
                          displayRevision?.title,
                        )}
                      >
                        <RevisionLabel
                          version={revisionNumber}
                          title={displayRevision?.title}
                          numbered={false}
                        />
                      </OverflowText>
                    </Text>
                  )}
                  {canEditTitle && !editingTitle && (
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
                    {getStatusBadge(isLive ? "live" : (status ?? "draft"))}
                  </Box>
                </Flex>
              )}
            </Flex>
          </Flex>
          <Flex align="center" justify="end" gap="4" flexGrow="1">
            {isLive && onNewDraft && (
              <Button onClick={onNewDraft} size="sm" variant="soft">
                New Draft
              </Button>
            )}
            {hasRevisions && isDraft && onReviewPublish && (
              <Button
                icon={<PiArrowRightBold />}
                iconPosition="right"
                onClick={onReviewPublish}
                style={{ whiteSpace: "nowrap" }}
              >
                Review and Publish
              </Button>
            )}
          </Flex>
        </Flex>
        <Separator size="4" my="3" />
        <Flex direction="column">
          <Flex
            align="center"
            justify="between"
            wrap="wrap"
            style={{ rowGap: "var(--space-1)", columnGap: "var(--space-4)" }}
          >
            <Metadata
              label={hasRevisions ? "Revised by" : "Created by"}
              value={(() => {
                const authorId =
                  hasRevisions && displayRevision
                    ? displayRevision.authorId
                    : fallbackOwnerId;
                return (
                  <EventUser
                    user={{
                      type: "dashboard",
                      id: authorId,
                      // EventUser resolves `id` against org members and
                      // overrides this; the fallback keeps legacy name/email
                      // owners (not in the member map) from rendering "Unknown".
                      name: getOwnerDisplay(authorId),
                      email: "",
                    }}
                    display="avatar-name-email"
                    size="sm"
                  />
                );
              })()}
            />
            <Flex align="center" gap="4" wrap="wrap">
              <Metadata
                label="Created"
                value={datetime(
                  hasRevisions && displayRevision
                    ? displayRevision.dateCreated
                    : fallbackDateCreated,
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
              return <CoAuthorsList coAuthorIds={coAuthorIds} mt="3" mb="3" />;
            })()}
          {hasRevisions && displayRevision && (
            <InlineRevisionDescription
              comment={displayRevision.comment}
              canEdit={!!isDraft && canEditDescriptionProp}
              onEdit={onEditDescription}
            />
          )}
        </Flex>
      </Frame>
    </>
  );
}
