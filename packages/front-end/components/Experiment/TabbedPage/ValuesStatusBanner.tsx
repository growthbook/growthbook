import { ReactNode, useCallback, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckCircle, PiPencil, PiWarningOctagon } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ago } from "shared/dates";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import EventUser from "@/components/Avatar/EventUser";
import { useUser } from "@/services/UserContext";
import useManagedFlagReview from "@/components/Experiment/LinkedChanges/useManagedFlagReview";
import { hasUnpublishedChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import {
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";
import { useEditsBlockedReason, useLiveView } from "./ExperimentEdits";
import { getValuesStatus, ReviewEvent, ValuesStatus } from "./valuesStatus";

export const VALUES_STATUS_BANNER_ID = "values-status-banner";

// Just under the pinned tab bar.
const STICKY_TOP_PX = TABS_HEADER_HEIGHT_PX + TABS_BAR_HEIGHT_PX + 8;

type Props = {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  // The Values flag, while it has a draft.
  managed: LinkedFeatureInfo | null;
  mutate: () => void;
  // null where the review can't open, e.g. an archived experiment.
  openReview: (() => void) | null;
};

type Resolved = {
  status: ValuesStatus | null;
  run: (() => Promise<void> | void) | null;
};

// What the page shows, whoever's flags they are.
function useViewedChanges({ experiment, linkedFeatures }: Props) {
  const { live } = useLiveView();
  return {
    experimentStatus: experiment.status,
    viewingLive: live,
    hasUnpublished: linkedFeatures.some(hasUnpublishedChanges),
  };
}

function useManagedStatus(
  props: Props & { managed: LinkedFeatureInfo },
): Resolved {
  const { experiment, managed, mutate, openReview } = props;
  const review = useManagedFlagReview({ experiment, info: managed, mutate });
  const { userId } = useUser();
  const viewed = useViewedChanges(props);
  const draft = managed.pendingDraft;

  // Newest first; a retracted verdict no longer stands.
  const log = [...review.reviewComments].reverse();
  const event = (
    entry: (typeof log)[number] | undefined,
  ): ReviewEvent | null =>
    entry ? { user: entry.user, ago: ago(entry.timestamp) } : null;
  const requestEntry = log.find((l) => l.action === "Review Requested");
  const verdictEntry = log.find(
    (l) =>
      (l.action === "Approved" || l.action === "Requested Changes") &&
      !l.retraction,
  );
  const submit = review.submit;
  const status = draft
    ? getValuesStatus({
        ...viewed,
        managed: {
          draft,
          canRequestReview: submit?.action === "request-review",
          canPublish: submit?.action === "publish",
          canReview: review.canReview,
          viewerRequested:
            requestEntry?.user?.type === "dashboard" &&
            requestEntry.user.id === userId,
          requested: event(requestEntry),
          verdict: event(verdictEntry),
        },
      })
    : null;
  const action = status?.cta?.action;
  return {
    status,
    run:
      action === "open"
        ? openReview
        : (action === "request" || action === "publish") && submit
          ? submit.run
          : null,
  };
}

function useUnmanagedStatus(props: Props): Resolved {
  const viewed = useViewedChanges(props);
  return { status: getValuesStatus({ ...viewed, managed: null }), run: null };
}

function StatusCta({
  status,
  run,
  setError,
}: Resolved & { setError: (error: string | null) => void }) {
  const editsBlocked = useEditsBlockedReason();
  if (!status?.cta || !run) return null;
  return (
    <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
      <Button
        variant="outline"
        onClick={run}
        setError={setError}
        disabled={!!editsBlocked}
      >
        {status.cta.label}
      </Button>
    </Tooltip>
  );
}

// Fixed, so the button holds its place as its label changes.
const CTA_WIDTH_PX = 150;

const TONES: Record<
  ValuesStatus["tone"],
  { icon: ReactNode; color: string; background: string }
> = {
  draft: {
    icon: <PiPencil size={18} />,
    color: "var(--amber-11)",
    background: "var(--amber-3)",
  },
  live: {
    icon: <PiPencil size={18} />,
    color: "var(--gray-11)",
    background: "var(--gray-3)",
  },
  approved: {
    icon: <PiCheckCircle size={18} />,
    color: "var(--green-11)",
    background: "var(--green-3)",
  },
  error: {
    icon: <PiWarningOctagon size={18} />,
    color: "var(--red-11)",
    background: "var(--red-3)",
  },
};

/**
 * What Setup is showing, where its unpublished changes stand, and the next
 * step with them, floating at the top of the column like the Feature Flag
 * page's.
 */
export function ValuesStatusBanner(props: Props) {
  return props.managed ? (
    <ManagedBanner {...props} managed={props.managed} />
  ) : (
    <UnmanagedBanner {...props} />
  );
}

function ManagedBanner(props: Props & { managed: LinkedFeatureInfo }) {
  return <Banner resolved={useManagedStatus(props)} {...props} />;
}

function UnmanagedBanner(props: Props) {
  return <Banner resolved={useUnmanagedStatus(props)} {...props} />;
}

function Banner({ resolved, openReview }: Props & { resolved: Resolved }) {
  const [pinned, setPinned] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const sentinel = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      setPinned(false);
      return;
    }
    observer.current = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      { rootMargin: `-${STICKY_TOP_PX}px 0px 0px 0px`, threshold: 0 },
    );
    observer.current.observe(el);
  }, []);

  if (!resolved.status) return null;
  return (
    <>
      <div ref={sentinel} aria-hidden style={{ height: 0 }} />
      <Box
        id={VALUES_STATUS_BANNER_ID}
        mt="3"
        style={{
          position: "sticky",
          top: STICKY_TOP_PX,
          zIndex: 900,
          scrollMarginTop: STICKY_TOP_PX,
        }}
      >
        <StatusStrip
          resolved={resolved}
          openReview={openReview}
          raised={pinned}
        />
      </Box>
    </>
  );
}

/** The same status and next step in place: the start popover's values row. */
export function ValuesStatusRow(props: Props) {
  return props.managed ? (
    <ManagedRow {...props} managed={props.managed} />
  ) : null;
}

function ManagedRow(props: Props & { managed: LinkedFeatureInfo }) {
  return (
    <StatusStrip
      resolved={useManagedStatus(props)}
      openReview={props.openReview}
    />
  );
}

/** The status, who acted and when, and the next step, in the status's tint. */
function StatusStrip({
  resolved,
  openReview,
  raised = false,
}: {
  resolved: Resolved;
  openReview: Props["openReview"];
  // Floating over the page, as a pinned banner does.
  raised?: boolean;
}) {
  const { setLive } = useLiveView();
  const [ctaError, setCtaError] = useState<string | null>(null);
  const { status } = resolved;
  if (!status) return null;
  const tone = TONES[status.tone];
  const { before, strong, after } = status.message;

  return (
    <Box
      px="4"
      py="2"
      style={{
        color: tone.color,
        backgroundColor: tone.background,
        borderRadius: "var(--radius-3)",
        boxShadow: raised ? "var(--shadow-3)" : undefined,
        transition: "box-shadow 200ms ease",
        display: "grid",
        gridTemplateColumns: `auto minmax(0, 1fr) ${CTA_WIDTH_PX}px`,
        alignItems: "center",
        gap: 12,
        minHeight: 48,
      }}
    >
      <span style={{ display: "flex" }}>{tone.icon}</span>
      <Box style={{ minWidth: 0 }}>
        <Text as="div" size="md" truncate>
          {before}
          <strong>{strong}</strong>
          {after}
          {status.link === "switch-to-unpublished" ? (
            <>
              {" "}
              <Link onClick={() => setLive(false)}>
                <strong>Switch to unpublished</strong>
              </Link>
            </>
          ) : status.link === "view-feedback" && openReview ? (
            <>
              {" "}
              <Link onClick={openReview}>
                <strong>View feedback</strong>
              </Link>
            </>
          ) : null}
        </Text>
        {status.byline ? (
          <Text as="div" size="sm" color="text-mid" truncate>
            {status.byline.verb}{" "}
            <EventUser user={status.byline.event.user} display="name" />
            {" · "}
            {status.byline.event.ago}
          </Text>
        ) : null}
        {ctaError ? (
          <HelperText status="error" size="sm">
            {ctaError}
          </HelperText>
        ) : null}
      </Box>
      <Flex justify="end">
        <StatusCta {...resolved} setError={setCtaError} />
      </Flex>
    </Box>
  );
}
