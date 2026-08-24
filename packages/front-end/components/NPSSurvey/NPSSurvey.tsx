import { useCallback, useEffect, useRef, useState } from "react";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { Flex, IconButton, TextArea } from "@radix-ui/themes";
import { PiArrowLeft, PiX } from "react-icons/pi";
import { useForm } from "react-hook-form";
import {
  NpsCategory,
  NPS_MAX_FEEDBACK_LENGTH,
  npsCategoryOf,
  npsValueOf,
} from "shared/nps";
import { NpsDisposition, NpsSurveyStatus } from "shared/validators";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Portal from "@/components/Modal/Portal";
import { isCloud } from "@/services/env";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import styles from "./NPSSurvey.module.scss";
import {
  inSampledCohort,
  meetsMinimumTenure,
  parseSurveyConfig,
  withinCooldown,
} from "./nps.utils";

type Panel = "question" | "feedback" | "thanks";

const STORAGE_KEY = "gb_nps_v1";
const FEEDBACK_FIELD_ID = "gb-nps-feedback";
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

// Staff override: `?show-nps` forces the survey to appear for superAdmins,
// bypassing the sampling, tenure and cooldown gates.
function forceShowRequested(isStaff: boolean): boolean {
  if (typeof window === "undefined") return false;
  if (!new URLSearchParams(window.location.search).has("show-nps"))
    return false;
  return isStaff;
}

// "shown" = displayed but never acted on, so ignoring the card suppresses it
// the same way answering or dismissing does.
type StoredStatus = NpsSurveyStatus | "shown";
type StoredState = { status: StoredStatus; date: string };

// localStorage is user-writable: validate rather than cast.
function readStored(key: string): StoredState | null {
  try {
    const raw = localStorage.getItem(key);
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

function writeStored(key: string, status: StoredStatus): void {
  try {
    localStorage.setItem(
      key,
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
  // Tunable in GrowthBook without a deploy; parseSurveyConfig documents the
  // accepted shapes.
  const surveyConfig: unknown = useFeatureValue("nps-survey", 0);
  const { rate: sampleRate, minTenureDays } = parseSurveyConfig(surveyConfig);
  const { apiCall } = useAuth();
  const {
    npsSurveyAt,
    accountCreatedAt,
    npsSurveyEnabled,
    orgSuspended,
    userId,
    superAdmin,
  } = useUser();
  // Per-user: the server half of this cooldown is per-account, so a shared key
  // would let one person suppress the next account on the same browser.
  const storageKey = userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
  // Staff-gated rather than flag-gated; the server re-checks this before
  // honouring `preview`.
  const isStaff = !!superAdmin;
  const suppressed = withinCooldown(npsSurveyAt);
  // Tenure is the account's own age, so a new hire at an established org isn't
  // asked on their first day.
  const eligible =
    meetsMinimumTenure(accountCreatedAt, minTenureDays) &&
    inSampledCohort(userId, sampleRate);
  // Latched, not derived: `?show-nps` disappears on client-side navigation,
  // which would flip a staff preview into a real response mid-card.
  const [forceShow, setForceShow] = useState(false);
  useEffect(() => {
    if (forceShow) return;
    if (forceShowRequested(isStaff)) setForceShow(true);
  }, [isStaff, forceShow]);

  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panel, setPanel] = useState<Panel>("question");

  // react-hook-form's ref-backed store lets the pagehide/Escape listeners read
  // current values via a stable getValues() without re-subscribing per keystroke.
  const { register, setValue, getValues, watch } = useForm<{
    score: number | null;
    feedback: string;
  }>({ defaultValues: { score: null, feedback: "" } });
  const score = watch("score");

  // Send-once latch, set synchronously because async state updates could
  // double-fire inside the unload listener.
  const sentRef = useRef(false);
  // Arrows select, as the radiogroup role promises, so a score can be set while
  // the user is still browsing. Only a click or Enter counts as answering.
  const confirmedRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);

  // Cooldown is checked cross-device via the user record and per-device via
  // localStorage.
  useEffect(() => {
    // Admin override: shows regardless of the feature, the webhook, sampling,
    // tenure, cooldown or org state. Preview records no suppression, so guard on
    // sentRef or the card returns frozen on the thanks panel.
    if (forceShow) {
      if (!sentRef.current) setVisible(true);
      return;
    }
    // A suspended org's POST is rejected, which would silently drop the answer.
    if (orgSuspended) return;
    // Deployment gate: NPS_SLACK_WEBHOOK configured, as a boolean. The webhook
    // is the opt-in — a self-hosted operator can set their own and responses go
    // to their Slack. Gating on it rather than isCloud() keys on the thing
    // actually needed to deliver a response, and still works in dev.
    if (
      !npsSurveyEnabled ||
      !eligible ||
      suppressed ||
      withinCooldown(readStored(storageKey)?.date)
    )
      return;
    const t = window.setTimeout(() => {
      // A background tab still fires this timer; don't spend the once-per-cycle
      // slot on a card nobody saw.
      if (document.visibilityState !== "visible") return;
      writeStored(storageKey, "shown");
      setVisible(true);
    }, SHOW_DELAY);
    return () => window.clearTimeout(t);
  }, [
    eligible,
    npsSurveyEnabled,
    suppressed,
    forceShow,
    orgSuspended,
    storageKey,
  ]);

  // Tabs opened together all pass the gate before any records an impression, so
  // each could answer. `storage` fires only in the other tabs, so the one that
  // wrote keeps its thanks panel.
  useEffect(() => {
    if (!visible) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || e.newValue === null) return;
      // Only stand down for a real answer: a bare "shown" impression from another
      // tab would otherwise tear this card away mid-answer.
      let status: unknown;
      try {
        status = (JSON.parse(e.newValue) as { status?: unknown })?.status;
      } catch {
        return;
      }
      if (status !== "responded" && status !== "dismissed") return;
      sentRef.current = true;
      setClosing(false);
      setVisible(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [visible, storageKey]);

  // Best-effort cross-device suppression; keepalive lets it survive a tab close.
  // Deliberately does not refetch /user afterwards: nothing in this session reads
  // npsSurveyAt again, so a bootstrap refetch would be pure waste.
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
        // Scores are anonymous enough to report anywhere, free text is not: a
        // self-hosted org's feedback stays with that org.
        feedback: isCloud() ? feedbackText : "",
        disposition,
        preview: forceShow,
        survey_id: SURVEY_ID,
      });
      if (!forceShow) writeStored(storageKey, "responded");
      persistServer("responded", {
        score: s,
        feedback: feedbackText,
        disposition,
      });
    },
    [persistServer, getValues, forceShow, storageKey],
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
    if (confirmedRef.current && getValues("score") !== null) {
      emitResponse("dismissed");
    } else {
      if (!forceShow) writeStored(storageKey, "dismissed");
      persistServer("dismissed");
    }
    dismissCard();
  }, [
    emitResponse,
    dismissCard,
    persistServer,
    getValues,
    forceShow,
    storageKey,
  ]);

  const handleSubmit = useCallback(
    (disposition: Extract<NpsDisposition, "submitted" | "skipped">) => {
      emitResponse(disposition);
      setPanel("thanks");
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(dismissCard, THANKS_DURATION);
    },
    [emitResponse, dismissCard],
  );

  // True abandonment: leaving with a score selected but not submitted. Bail on
  // `persisted` — that's the back-forward cache, not an exit, and latching there
  // would kill a response the user could still return and finish.
  useEffect(() => {
    if (!visible) return;
    const flush = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      if (
        confirmedRef.current &&
        getValues("score") !== null &&
        !sentRef.current
      ) {
        emitResponse("abandoned");
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [visible, emitResponse, getValues]);

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
            <Heading as="h2" size="sm" mb="4" mr="3">
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
                  // Roving tabindex: the scale is one tab stop, not eleven.
                  tabIndex={score === s || (score === null && s === 0) ? 0 : -1}
                  className={`${styles.cell} ${
                    CATEGORY_UI[npsCategoryOf(s)].className
                  }`}
                  onClick={() => {
                    setValue("score", s);
                    confirmedRef.current = true;
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
                      // Arrows move and select together, so aria-checked follows.
                      setValue("score", next);
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
              <Text size="sm" color="text-low">
                Not at all likely
              </Text>
              <Text size="sm" color="text-low">
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
              size="sm"
              icon={<PiArrowLeft />}
              mb="3"
              onClick={() => {
                // Drop the retracted score and its draft. react-hook-form keeps
                // unmounted values, so a comment written for the old score would
                // otherwise be sent with the new one under a different prompt.
                setValue("score", null);
                setValue("feedback", "");
                confirmedRef.current = false;
                setPanel("question");
              }}
            >
              Change score
            </Button>
            <Text
              as="label"
              htmlFor={FEEDBACK_FIELD_ID}
              size="md"
              weight="semibold"
              color="text-high"
            >
              {CATEGORY_UI[cat].prompt}
            </Text>
            <TextArea
              id={FEEDBACK_FIELD_ID}
              rows={3}
              mt="2"
              maxLength={NPS_MAX_FEEDBACK_LENGTH}
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
            <Heading as="h2" size="sm" align="center" mb="2">
              Thanks — that&apos;s really helpful.
            </Heading>
            <Text as="p" size="md" color="text-mid" align="center">
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
