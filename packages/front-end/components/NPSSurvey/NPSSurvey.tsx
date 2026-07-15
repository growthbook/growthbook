import { useCallback, useEffect, useRef, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Flex, IconButton, TextArea } from "@radix-ui/themes";
import { PiArrowLeft, PiX } from "react-icons/pi";
import { useForm } from "react-hook-form";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Portal from "@/components/Modal/Portal";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import styles from "./NPSSurvey.module.scss";

type Panel = "question" | "feedback" | "thanks";
type Category = "detractor" | "passive" | "promoter";
// How the user left the survey after picking a score; only "submitted"
// (an explicit "Send feedback" click) carries the comment text.
type ExitDisposition = "submitted" | "skipped" | "dismissed" | "abandoned";

const STORAGE_KEY = "gb_nps_v1";
const SURVEY_ID = "app-nps";
const SHOW_DELAY = 1100;
const THANKS_DURATION = 2600;
const EXIT_DURATION = 360;
const RESURVEY_DAYS = 90;
const RESURVEY_MS = RESURVEY_DAYS * 24 * 60 * 60 * 1000;
const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const PROMPTS: Record<Category, string> = {
  detractor: "What's the main thing we should improve?",
  passive: "What would make GrowthBook a 10 for you?",
  promoter: "What do you enjoy most about GrowthBook?",
};

const CATEGORY_LABEL: Record<Category, string> = {
  detractor: "Detractor",
  passive: "Passive",
  promoter: "Promoter",
};

const CAT_CLASS: Record<Category, string> = {
  detractor: styles.catDetractor,
  passive: styles.catPassive,
  promoter: styles.catPromoter,
};

function categoryOf(score: number): Category {
  return score <= 6 ? "detractor" : score <= 8 ? "passive" : "promoter";
}

function npsValue(score: number): number {
  return score >= 9 ? 1 : score <= 6 ? -1 : 0;
}

// True while a user is inside the re-survey cooldown window after their last prompt.
function withinCooldown(dateIso?: string | null): boolean {
  if (!dateIso) return false;
  const t = new Date(dateIso).getTime();
  return !Number.isNaN(t) && Date.now() - t < RESURVEY_MS;
}

// Dev/staff override: `?show-nps` forces the survey to appear, bypassing the
// cooldown and delay. Gated on the `nps-survey-preview` flag, which is targeted
// to the GrowthBook org in GrowthBook — so org targeting lives in the flag, not
// in hardcoded host/role checks. Devs enable the flag locally to test.
function forceShowRequested(previewFlagOn: boolean): boolean {
  if (typeof window === "undefined") return false;
  if (!new URLSearchParams(window.location.search).has("show-nps"))
    return false;
  return previewFlagOn;
}

type StoredState =
  | { status: "responded"; score: number; date: string }
  | { status: "dismissed"; date: string };

function readStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  } catch {
    return null;
  }
}

function writeStored(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const flagOn = useFeatureIsOn("nps-survey");
  const previewFlagOn = useFeatureIsOn("nps-survey-preview");
  const { apiCall } = useAuth();
  const { npsSurveyAt, updateUser } = useUser();
  const suppressed = withinCooldown(npsSurveyAt);

  const [visible, setVisible] = useState(false);
  const [forceShow, setForceShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panel, setPanel] = useState<Panel>("question");

  // Score + feedback live in react-hook-form, whose ref-backed store lets the
  // pagehide/visibilitychange/Escape listeners read current values through the
  // stable getValues() without re-subscribing on every keystroke.
  const { register, setValue, getValues, watch } = useForm<{
    score: number | null;
    feedback: string;
  }>({ defaultValues: { score: null, feedback: "" } });
  const score = watch("score");

  // Send-once latch; read and set synchronously inside unload-time listeners,
  // where async state updates could double-fire the response.
  const sentRef = useRef(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    setForceShow(forceShowRequested(previewFlagOn));
  }, [previewFlagOn]);

  // The `?show-nps` dev/staff override fires immediately and bypasses every gate;
  // otherwise show after a delay for Cloud users not in the re-survey cooldown
  // (checked cross-device via the user record, and per-device via localStorage).
  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    if (
      !flagOn ||
      !isCloud() ||
      suppressed ||
      withinCooldown(readStored()?.date)
    )
      return;
    const t = window.setTimeout(() => setVisible(true), SHOW_DELAY);
    return () => window.clearTimeout(t);
  }, [flagOn, suppressed, forceShow]);

  // Persist the cross-device suppression signal on the user's account (best-effort).
  // keepalive lets the write survive a tab close, so abandonment suppresses elsewhere too.
  const persistServer = useCallback(
    (
      status: "responded" | "dismissed",
      extra?: { score: number; feedback: string; disposition: ExitDisposition },
    ) => {
      void apiCall(`/user/nps-response`, {
        method: "POST",
        body: JSON.stringify({ status, ...extra }),
        keepalive: true,
      })
        .then(() => updateUser())
        .catch(() => {
          // best-effort; localStorage still suppresses on this device
        });
    },
    [apiCall, updateUser],
  );

  // Report the chosen score exactly once, tagged with how the survey was
  // exited. The comment text is only included on an explicit "Send feedback"
  // click — every other exit records the score alone, never an unsent draft.
  const emitResponse = useCallback(
    (disposition: ExitDisposition) => {
      const { score: s, feedback } = getValues();
      if (sentRef.current || s === null) return;
      sentRef.current = true;
      const feedbackText = disposition === "submitted" ? feedback.trim() : "";
      track("nps_response", {
        score: s,
        nps_value: npsValue(s),
        category: categoryOf(s),
        feedback: feedbackText,
        disposition,
        survey_id: SURVEY_ID,
      });
      writeStored({
        status: "responded",
        score: s,
        date: new Date().toISOString(),
      });
      persistServer("responded", {
        score: s,
        feedback: feedbackText,
        disposition,
      });
    },
    [persistServer, getValues],
  );

  const dismissCard = useCallback(() => {
    if (prefersReducedMotion()) {
      setVisible(false);
      return;
    }
    setClosing(true);
    window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, EXIT_DURATION);
  }, []);

  const handleClose = useCallback(() => {
    if (getValues("score") !== null) {
      emitResponse("dismissed");
    } else {
      writeStored({ status: "dismissed", date: new Date().toISOString() });
      persistServer("dismissed");
    }
    dismissCard();
  }, [emitResponse, dismissCard, persistServer, getValues]);

  const handleSubmit = useCallback(
    (disposition: "submitted" | "skipped") => {
      emitResponse(disposition);
      setPanel("thanks");
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(dismissCard, THANKS_DURATION);
    },
    [emitResponse, dismissCard],
  );

  // Catch true abandonment: tab hidden / navigating away with a score but no
  // submit — the score is recorded, the unsent draft is not.
  useEffect(() => {
    if (!visible) return;
    const flush = () => {
      if (getValues("score") !== null && !sentRef.current) {
        emitResponse("abandoned");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [visible, emitResponse, getValues]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, handleClose]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  if (!visible) return null;

  const cat: Category | null = score !== null ? categoryOf(score) : null;

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
                  className={`${styles.cell} ${CAT_CLASS[categoryOf(s)]}`}
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
              <span className={`${styles.scorebox} ${CAT_CLASS[cat]}`}>
                {score}
              </span>
              <span className={`${styles.category} ${CAT_CLASS[cat]}`}>
                {CATEGORY_LABEL[cat]}
              </span>
            </Flex>
            <label className={styles.prompt} htmlFor="gb-nps-feedback">
              {PROMPTS[cat]}
            </label>
            <TextArea
              id="gb-nps-feedback"
              rows={3}
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
