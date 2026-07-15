import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
import Link from "@/ui/Link";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";
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
  // Render the banner inline (scrolls with the page) instead of pinning it to
  // the top on scroll. The sticky banner doesn't suit denser pages like Configs.
  disablePinning?: boolean;
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
  disablePinning = false,
}: RevisionSummaryCardProps) {
  const { getOwnerDisplay } = useUser();
  const [bannerPinned, setBannerPinned] = useState(false);
  // Pinned once a sentinel above the banner scrolls past the 110px sticky offset
  // (more reliable than getBoundingClientRect). Ref callback so the observer
  // re-attaches if the sentinel mounts later (e.g. a draft created on a bare page).
  const bannerSentinelObserver = useRef<IntersectionObserver | null>(null);
  const bannerSentinelRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (bannerSentinelObserver.current) {
        bannerSentinelObserver.current.disconnect();
        bannerSentinelObserver.current = null;
      }
      if (!el || disablePinning) {
        setBannerPinned(false);
        return;
      }
      const observer = new IntersectionObserver(
        ([entry]) => setBannerPinned(!entry.isIntersecting),
        { rootMargin: "-110px 0px 0px 0px", threshold: 0 },
      );
      observer.observe(el);
      bannerSentinelObserver.current = observer;
    },
    [disablePinning],
  );

  // The "Review & Publish" CTA portals between the card slot and the banner
  // slot so it stays reachable when pinned (mirrors the feature flow).
  const ctaSlotRef = useRef<HTMLDivElement>(null);
  const bannerCtaSlotRef = useRef<HTMLDivElement>(null);
  const [draftCtaPortalHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const div = document.createElement("div");
    div.style.display = "contents";
    return div;
  });
  // No deps: ctaSlotRef starts null and populates after the full render.
  // appendChild is idempotent when the host is already in the target slot.
  useLayoutEffect(() => {
    if (!draftCtaPortalHost) return;
    const target = bannerPinned ? bannerCtaSlotRef.current : ctaSlotRef.current;
    if (target) target.appendChild(draftCtaPortalHost);
  });

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
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(selectedRevision?.title || "");
    setActionError(null);
  }, [selectedRevision?.id, selectedRevision?.title]);

  const commitTitleEdit = async () => {
    if (!selectedRevision) return;
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== (selectedRevision.title ?? "")) {
      try {
        setActionError(null);
        await onTitleCommit(selectedRevision.id, next);
      } catch (e) {
        setActionError(e.message);
      }
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
                <Link onClick={() => onSelectRevision(null)}>
                  <strong>Switch to live</strong>
                </Link>
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
                      <Link onClick={() => onSelectRevision(activeDrafts[0])}>
                        <strong>Switch to draft</strong>
                      </Link>
                    </>
                  )}
                </>
              ),
            }
          : null;

  // Rendered via the portal host above; pure navigation into the review surface.
  const reviewPublishCta =
    hasRevisions && isDraft && onReviewPublish ? (
      <Box>
        <Button
          icon={<PiArrowRightBold />}
          iconPosition="right"
          onClick={onReviewPublish}
          style={{ whiteSpace: "nowrap" }}
        >
          Review &amp; Publish
        </Button>
      </Box>
    ) : null;

  return (
    <>
      {bannerProps && (
        <>
          <div ref={bannerSentinelRef} aria-hidden style={{ height: 0 }} />
          <div
            style={{
              position: disablePinning ? "static" : "sticky",
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
                maxWidth: bannerPinned ? 1280 : 1500,
                boxShadow: bannerPinned ? "var(--shadow-3)" : undefined,
                transition: "all 200ms ease",
                pointerEvents: "auto",
              }}
            >
              <Box
                px="4"
                py="3"
                style={{
                  color: bannerProps.color,
                  backgroundColor: bannerProps.bgColor,
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span />
                <Flex
                  align="center"
                  justify="center"
                  gap="2"
                  style={{ gridColumn: 2 }}
                >
                  <span style={{ display: "flex", flexGrow: 0, flexShrink: 0 }}>
                    {bannerProps.icon}
                  </span>
                  <span style={{ fontSize: "var(--font-size-2)" }}>
                    {bannerProps.message}
                  </span>
                </Flex>
                <Flex
                  align="center"
                  gap="2"
                  justify="end"
                  style={{ flexShrink: 0, gridColumn: 3 }}
                >
                  {/* Slot: reviewPublishCta portal mounts here when pinned */}
                  <div ref={bannerCtaSlotRef} />
                </Flex>
              </Box>
            </div>
          </div>
        </>
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
              <Button
                onClick={onNewDraft}
                setError={setActionError}
                size="sm"
                variant="soft"
              >
                New Draft
              </Button>
            )}
            {/* Slot: reviewPublishCta portal mounts here when not pinned */}
            {isDraft && <div ref={ctaSlotRef} />}
          </Flex>
        </Flex>
        {actionError && (
          <Callout status="error" mt="2">
            {actionError}
          </Callout>
        )}
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
      {/* Portal: renders reviewPublishCta into whichever slot is active */}
      {draftCtaPortalHost && createPortal(reviewPublishCta, draftCtaPortalHost)}
    </>
  );
}
