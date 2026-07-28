import { useCallback, useEffect, useRef, useState } from "react";
import { useFeatureIsOn, useFeatureValue } from "@growthbook/growthbook-react";
import { Flex, IconButton, TextArea } from "@radix-ui/themes";
import { PiArrowLeft, PiX } from "react-icons/pi";
import { useForm } from "react-hook-form";
import {
  NPS_CATEGORY_META,
  NpsCategory,
  npsCategoryOf,
  npsValueOf,
} from "shared/nps";
import { NpsDisposition, NpsSurveyStatus } from "shared/validators";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Portal from "@/components/Modal/Portal";
import { useKeydown } from "@/hooks/useKeydown";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import styles from "./NPSSurvey.module.scss";
import {
  inSampledCohort,
  meetsMinimumTenure,
  parseSampleRate,
  withinCooldown,
} from "./nps.utils";

type Panel = "question" | "feedback" | "thanks";

const STORAGE_KEY = "gb_nps_v1";
const SURVEY_ID = "app-nps";
const SHOW_DELAY = 1100;
const THANKS_DURATION = 2600;
const EXIT_DURATION = 360;
const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const CATEGORY_UI: Record<NpsCategory, { prompt: string; className: string }> =
  {
    detractor: {
      prompt: "What's the main thing we should improve?",
      className: styles.catDetractor,
    },
    passive: {
      prompt: "What would make GrowthBook a 10 for you?",
      className: styles.catPassive,
    },
    promoter: {
      prompt: "What do you enjoy most about GrowthBook?",
      className: styles.catPromoter,
    },
  };

// Dev/staff override: `?show-nps` forces the survey to appear, bypassing the
// sampling, tenure and cooldown gates (but not the Cloud check). Gated on the
// `nps-survey-preview` flag, which is targeted to the GrowthBook org in
// GrowthBook — so org targeting lives in the flag, not in hardcoded host/role
// checks. Devs enable the flag locally to test.
function forceShowRequested(previewFlagOn: boolean): boolean {
  if (typeof window === "undefined") return false;
  if (!new URLSearchParams(window.location.search).has("show-nps"))
    return false;
  return previewFlagOn;
}

// "shown" records that the card was displayed but never acted on, so ignoring
// it suppresses re-prompting the same way answering or dismissing does.
type StoredStatus = NpsSurveyStatus | "shown";
type StoredState = { status: StoredStatus; date: string };

// localStorage is user-writable, so treat it as untrusted: keep only the fields
// we actually rely on and drop anything malformed rather than trusting a cast.
function readStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { status, date } = parsed as Record<string, unknown>;
    if (typeof date !== "string") return null;
    if (
      status !== "responded" &&
      status !== "dismissed" &&
      status !== "shown"
    ) {
      return null;
    }
    return { status, date };
  } catch {
    return null;
  }
}

function writeStored(status: StoredStatus): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status, date: new Date().toISOString() }),
    );
  } catch {
    // localStorage may be unavailable (private mode); ignore
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="15" strokeOpacity={0.28} />
      <path d="M11 18.5l4.5 4.5L25 13" pathLength={1} />
    </svg>
  );
}

export default function NPSSurvey() {
  // The `nps-survey` feature carries the sample rate as a PERCENT (0 = off,
  // 5 = 5% of eligible users per 90-day cycle, 100 = everyone), so volume is
  // tunable in GrowthBook without a deploy. Targeting rules still apply.
  const sampleRate = parseSampleRate(useFeatureValue("nps-survey", 0));
  const previewFlagOn = useFeatureIsOn("nps-survey-preview");
  const { apiCall } = useAuth();
  const { npsSurveyAt, orgSuspended, userId, user } = useUser();
  const suppressed = withinCooldown(npsSurveyAt);
  // Sample a slice of long-enough-tenured users rather than prompting everyone
  // at once, which would spike responses and then go quiet. Tenure is the
  // user's own join date, so a new hire at an established org isn't asked on
  // their first day.
  const eligible =
    meetsMinimumTenure(user?.dateCreated) &&
    inSampledCohort(userId, sampleRate);
  // Derived, not state: a pure read of the URL plus the preview flag.
  const forceShow = forceShowRequested(previewFlagOn);

  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panel, setPanel] = useState<Panel>("question");

  // Score + feedback live in react-hook-form, whose ref-backed store lets the
  // pagehide/Escape listeners read current values through the stable
  // getValues() without re-subscribing on every keystroke.
  const { register, setValue, getValues, watch } = useForm<{
    score: number | null;
    feedback: string;
  }>({ defaultValues: { score: null, feedback: "" } });
  const score = watch("score");

  // Send-once latch, read and set synchronously inside the unload listener
  // where async state updates could double-fire. A latch can only be set on a
  // page that is being discarded (see the pagehide handler), so it never needs
  // to be superseded by a later submit.
  const sentRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);

  // Show after a delay for Cloud users who are sampled and not inside the
  // re-survey window (checked cross-device via the user record, and per-device
  // via localStorage — which also records a bare impression, so ignoring the
  // card suppresses it instead of re-prompting on every reload and new tab).
  // `?show-nps` skips those gates for staff, but never the Cloud check.
  useEffect(() => {
    // Never show where the response can't be recorded: a suspended org's POST
    // is rejected by the API, which would silently drop the answer.
    if (orgSuspended) return;
    if (forceShow) {
      setVisible(true);
      return;
    }
    // No deployment check here: the `nps-survey` feature is targeted in
    // GrowthBook and defaults off, and forwarding additionally requires the
    // private NPS_SLACK_WEBHOOK, so self-hosted instances are already gated
    // without a hardcoded Cloud test that would also block dev testing.
    if (!eligible || suppressed || withinCooldown(readStored()?.date)) return;
    const t = window.setTimeout(() => {
      writeStored("shown");
      setVisible(true);
    }, SHOW_DELAY);
    return () => window.clearTimeout(t);
  }, [eligible, suppressed, forceShow, orgSuspended]);

  // Persist the cross-device suppression signal on the user's account
  // (best-effort). keepalive lets the write survive a tab close, so abandonment
  // suppresses elsewhere too. Deliberately does not refetch /user afterwards:
  // localStorage already suppresses on this device and nothing in the current
  // session reads npsSurveyAt again, so a full bootstrap refetch (and the
  // app-wide re-render it triggers) would be pure waste — especially on the
  // unload path, where the browser cancels it anyway.
  const persistServer = useCallback(
    (
      status: NpsSurveyStatus,
      extra?: {
        score: number;
        feedback: string;
        disposition: NpsDisposition;
      },
    ) => {
      void apiCall(`/user/nps-response`, {
        method: "POST",
        body: JSON.stringify({ status, ...extra, preview: forceShow }),
        keepalive: true,
      }).catch(() => {
        // Best-effort; localStorage still suppresses on this device. Surface it
        // in telemetry so a broken contract can't masquerade as "no responses".
        track("nps_persist_failed", { survey_id: SURVEY_ID });
      });
    },
    [apiCall, forceShow],
  );

  // Report the chosen score, tagged with how the survey was exited. The comment
  // text is only included on an explicit "Send feedback" click — every other
  // exit records the score alone, never an unsent draft.
  const emitResponse = useCallback(
    (disposition: NpsDisposition) => {
      const { score: s, feedback } = getValues();
      if (sentRef.current || s === null) return;
      sentRef.current = true;
      const feedbackText = disposition === "submitted" ? feedback.trim() : "";
      track("nps_response", {
        score: s,
        nps_value: npsValueOf(s),
        category: npsCategoryOf(s),
        feedback: feedbackText,
        disposition,
        preview: forceShow,
        survey_id: SURVEY_ID,
      });
      if (!forceShow) writeStored("responded");
      persistServer("responded", {
        score: s,
        feedback: feedbackText,
        disposition,
      });
    },
    [persistServer, getValues, forceShow],
  );

  const dismissCard = useCallback(() => {
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
    if (prefersReducedMotion()) {
      setVisible(false);
      return;
    }
    setClosing(true);
    exitTimer.current = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, EXIT_DURATION);
  }, []);

  const handleClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (getValues("score") !== null) {
      emitResponse("dismissed");
    } else {
      if (!forceShow) writeStored("dismissed");
      persistServer("dismissed");
    }
    dismissCard();
  }, [emitResponse, dismissCard, persistServer, getValues, forceShow]);

  const handleSubmit = useCallback(
    (disposition: Extract<NpsDisposition, "submitted" | "skipped">) => {
      emitResponse(disposition);
      setPanel("thanks");
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(dismissCard, THANKS_DURATION);
    },
    [emitResponse, dismissCard],
  );

  // Catch true abandonment: leaving the page for good with a score selected but
  // not submitted — the score is recorded, the unsent draft is not. Bail when
  // `persisted` is set: the page went into the back-forward cache and may be
  // restored, so it isn't an exit, and reporting would latch a response the
  // user could still return to finish.
  useEffect(() => {
    if (!visible) return;
    const flush = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      if (getValues("score") !== null && !sentRef.current) {
        emitResponse("abandoned");
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [visible, emitResponse, getValues]);

  // Escape dismisses the survey — but only when it isn't closing something
  // else. `useKeydown` binds on window, so this runs after overlays that
  // preventDefault on their own Escape handling (Radix captures; GrowthBook's
  // Modal binds on window), and the DOM check covers overlays that close on
  // Escape without calling preventDefault at all.
  useKeydown("Escape", (e) => {
    if (!visible || e.defaultPrevented) return;
    if (
      document.querySelector(
        ".modal.show, [role=dialog][data-state=open], [role=menu][data-state=open]",
      )
    ) {
      return;
    }
    handleClose();
  });

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
    },
    [],
  );

  if (!visible) return null;

  const cat: NpsCategory | null = score !== null ? npsCategoryOf(score) : null;

  const card = (
    <div className={`${styles.wrapper} ${closing ? styles.closing : ""}`}>
      <div
        className={styles.card}
        role="dialog"
        aria-label="GrowthBook feedback survey"
        aria-live="polite"
      >
        <IconButton
          className={styles.close}
          variant="ghost"
          color="gray"
          size="1"
          onClick={handleClose}
          aria-label="Dismiss survey"
        >
          <PiX />
        </IconButton>

        {panel === "question" && (
          <div className={styles.panel}>
            <Text
              as="p"
              size="small"
              color="text-low"
              textTransform="uppercase"
              mb="2"
            >
              Quick question · ~15 sec
            </Text>
            <Heading as="h2" size="small" mb="4" mr="3">
              How likely are you to recommend GrowthBook to a friend or
              colleague?
            </Heading>
            {/* Hand-rolled radiogroup: the 11-cell scale needs per-cell
                detractor/passive/promoter color grading, which RadioGroup /
                RadioCards from the design system can't express. */}
            <div
              className={styles.scale}
              role="radiogroup"
              aria-label="Score from 0 to 10"
            >
              {SCORES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={score === s}
                  aria-label={`Score ${s}`}
                  data-score={s}
                  className={`${styles.cell} ${
                    CATEGORY_UI[npsCategoryOf(s)].className
                  }`}
                  onClick={() => {
                    setValue("score", s);
                    setPanel("feedback");
                  }}
                  onKeyDown={(e) => {
                    let next: number | null = null;
                    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                      next = Math.min(10, s + 1);
                    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                      next = Math.max(0, s - 1);
                    }
                    if (next !== null) {
                      e.preventDefault();
                      const el =
                        e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                          `[data-score="${next}"]`,
                        );
                      el?.focus();
                    }
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <Flex justify="between" mt="2">
              <Text size="small" color="text-low">
                Not at all likely
              </Text>
              <Text size="small" color="text-low">
                Extremely likely
              </Text>
            </Flex>
          </div>
        )}

        {panel === "feedback" && score !== null && cat && (
          <div className={styles.panel}>
            <Button
              variant="ghost"
              color="gray"
              size="xs"
              icon={<PiArrowLeft />}
              mb="3"
              onClick={() => setPanel("question")}
            >
              Change score
            </Button>
            <Flex align="center" gap="3" mb="4">
              <span
                className={`${styles.scorebox} ${CATEGORY_UI[cat].className}`}
              >
                {score}
              </span>
              <span
                className={`${styles.category} ${CATEGORY_UI[cat].className}`}
              >
                {NPS_CATEGORY_META[cat].label}
              </span>
            </Flex>
            <Text
              as="label"
              htmlFor="gb-nps-feedback"
              size="medium"
              weight="semibold"
              color="text-high"
            >
              {CATEGORY_UI[cat].prompt}
            </Text>
            <TextArea
              id="gb-nps-feedback"
              rows={3}
              mt="2"
              placeholder="Optional — a sentence is plenty"
              {...register("feedback")}
            />
            <Flex justify="between" align="center" mt="3">
              <Button
                variant="ghost"
                color="gray"
                onClick={() => handleSubmit("skipped")}
              >
                Skip
              </Button>
              <Button onClick={() => handleSubmit("submitted")}>
                Send feedback
              </Button>
            </Flex>
          </div>
        )}

        {panel === "thanks" && (
          <div className={`${styles.panel} ${styles.thanks}`}>
            <span className={styles.check}>
              <CheckMark />
            </span>
            <Heading as="h2" size="small" align="center" mb="2">
              Thanks — that&apos;s really helpful.
            </Heading>
            <Text as="p" size="medium" color="text-mid" align="center">
              Your feedback shapes what we build next.
            </Text>
          </div>
        )}
      </div>
    </div>
  );

  // Portal renders into #portal-root (inside <RadixTheme>), so the Radix
  // theme CSS variables (panel background, shadow, colors) resolve.
  return <Portal>{card}</Portal>;
}
