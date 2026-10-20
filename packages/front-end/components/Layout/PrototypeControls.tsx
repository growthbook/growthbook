import clsx from "clsx";
import {
  KeyboardEvent,
  PointerEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PiCaretDownBold, PiCaretUpBold, PiInfoBold } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import { isPrototype } from "@/services/env";
import {
  GROWTHBOT_STATES,
  resetGrowthBotPrototype,
  setGrowthBotCanUpgrade,
  setGrowthBotState,
  useGrowthBotPrototype,
} from "@/components/Agent/prototypeGrowthBotState";
import {
  KeyNoticeState,
  LICENSE_NOTICE_OPTIONS,
  LicenseNoticeState,
  PayloadNoticeState,
  PrototypeNotices,
  resetPrototypeNotices,
  setPrototypeNotice,
  usePrototypeNotices,
  UsageNoticeState,
} from "@/components/Notices/prototypeNotices";
import {
  setPrototypeMockConversation,
  usePrototypeMockConversation,
} from "@/components/Agent/prototypeMockConversation";
import styles from "./PrototypeControls.module.scss";

// PROTOTYPE ONLY (set in review): a panel of prototype settings, in the
// lower-right corner, styled apart from the product (dark, monospace,
// dashed outline) so it doesn't read as part of the UI. Each setting is
// kept in this browser (localStorage) and shared through the hooks below.

const MULTI_ORG_KEY = "gb-prototype-multiple-orgs";
const EXISTING_COLORS_KEY = "gb-prototype-existing-page-colors";
const INTERIM_SETTINGS_KEY = "gb-prototype-interim-settings";
const DOCKED_GROWTHBOT_KEY = "gb-prototype-docked-growthbot";
const SHOW_LIVE_CHAT_KEY = "gb-prototype-show-live-chat";
const LIVE_CHAT_IN_HELP_KEY = "gb-prototype-live-chat-in-help";
const CURRENT_NOTICES_KEY = "gb-prototype-current-header-notices";
const COLLAPSED_KEY = "gb-prototype-panel-collapsed";
// v2: right and bottom (was left and top).
const POSITION_KEY = "gb-prototype-panel-position-v2";
const CHANGE_EVENT = "gb-prototype-settings-change";
// On <html> while "Existing page colors" is on, for the header's and side
// nav's styles (TopNav.module.scss).
export const EXISTING_COLORS_CLASS = "prototype-existing-page-colors";

// On until turned off (set in review): what a browser that hasn't changed
// them starts with, so reviewers see the current direction. Docked
// GrowthBot, and live chat shown in the Help menu. The rest start off.
const DEFAULT_ON = new Set([
  DOCKED_GROWTHBOT_KEY,
  SHOW_LIVE_CHAT_KEY,
  LIVE_CHAT_IN_HELP_KEY,
]);

function readSetting(key: string): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? DEFAULT_ON.has(key) : value === "true";
  } catch (e) {
    return DEFAULT_ON.has(key);
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeSetting(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch (e) {
    // Storage blocked: the setting lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// Reset to defaults (set in review): every setting in the panel back to
// how a fresh browser starts (DEFAULT_ON above), GrowthBot's demo state
// and the header notices (all off) too. Where the panel sits and whether it's collapsed stay as they are.
const SETTING_KEYS = [
  MULTI_ORG_KEY,
  EXISTING_COLORS_KEY,
  INTERIM_SETTINGS_KEY,
  DOCKED_GROWTHBOT_KEY,
  SHOW_LIVE_CHAT_KEY,
  LIVE_CHAT_IN_HELP_KEY,
  CURRENT_NOTICES_KEY,
];

function resetAllSettings() {
  try {
    SETTING_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (e) {
    // Storage blocked: nothing saved to clear.
  }
  resetGrowthBotPrototype();
  resetPrototypeNotices();
  setPrototypeMockConversation(false);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function useSetting(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readSetting(key),
    () => DEFAULT_ON.has(key),
  );
}

// "Multiple organizations": the profile menu acts as if the user is in
// several organizations (ProfileMenu.tsx). Off on the server.
export function usePrototypeMultipleOrgs(): boolean {
  return useSetting(MULTI_ORG_KEY);
}

// "Interim colors" (labelled "Existing page colors" until set in review):
// the header and side nav take the existing
// product pages' colours (the light purple page background) instead of the
// redesign's white, to demo them beside pages not yet redesigned.
export function usePrototypeExistingPageColors(): boolean {
  return useSetting(EXISTING_COLORS_KEY);
}

// "Interim settings menu": until Settings is redesigned as its own page
// with its own navigation, the side nav's Settings opens a menu of today's
// settings pages (AppRail.tsx; SDK Configuration is a main section), and
// /settings is today's General settings. Off: the redesign (a single
// Settings link, /settings a placeholder).
export function usePrototypeInterimSettings(): boolean {
  return useSetting(INTERIM_SETTINGS_KEY);
}

// "Docked GrowthBot" (set in review): the GrowthBot drawer as part of the
// page's chrome, a full-height right rail (set in review; tried below the
// header) that the page makes room for, instead of floating over it (AgentPanel.tsx). Expanded, it fills the
// page area (focus mode). Off: as before.
export function usePrototypeDockedGrowthBot(): boolean {
  return useSetting(DOCKED_GROWTHBOT_KEY);
}

// "Show live chat" (set in review): a mock of the live chat (Pylon), its
// bubble in the lower-right corner opening a mock chat window
// (MockLiveChat.tsx). Mock only: Pylon isn't loaded.
export function usePrototypeShowLiveChat(): boolean {
  return useSetting(SHOW_LIVE_CHAT_KEY);
}

// "Live chat in Help menu" (set in review), with Show live chat on: no
// bubble; the side nav's Help menu opens the mock chat instead, with a fake
// unread badge on Help (HelpMenu.tsx). Off, or without Show live chat: as
// before.
export function usePrototypeLiveChatInHelp(): boolean {
  const show = useSetting(SHOW_LIVE_CHAT_KEY);
  const inHelp = useSetting(LIVE_CHAT_IN_HELP_KEY);
  return show && inHelp;
}

// "Current product treatment" (set in review): the header's notices as the
// product shows them today, main's NoticeStack (the top notice as a pill,
// the rest behind "+N", before GrowthBot), in place of the redesign's
// banner and warnings badge (TopNav.tsx). Off by default: the redesign.
// The Header notices choices drive either.
export function usePrototypeCurrentHeaderNotices(): boolean {
  return useSetting(CURRENT_NOTICES_KEY);
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  info,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  // What the setting does: an info icon after the label, its tooltip on
  // hover or keyboard focus (set in review).
  info?: string;
}) {
  const toggle = (
    <label className={styles.setting}>
      <input
        type="checkbox"
        role="switch"
        className={styles.switchInput}
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      {label}
    </label>
  );
  if (!info) return toggle;
  return (
    <div className={styles.settingRow}>
      {toggle}
      <Tooltip content={info} side="top" style={{ maxWidth: 260 }}>
        <button
          type="button"
          className={styles.info}
          aria-label={`About ${label}`}
        >
          <PiInfoBold size={13} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

// GrowthBot's demo states (prototypeGrowthBotState.ts; set in review), only
// with NEXT_PUBLIC_PROTOTYPE=true: Default, Disabled or Limit reached,
// "Can upgrade" for the limit's two versions, and Reset (back to Default).
function GrowthBotControls() {
  const { state, canUpgrade } = useGrowthBotPrototype();
  const mockConversation = usePrototypeMockConversation();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>GrowthBot</legend>
      <div className={styles.segmented}>
        {GROWTHBOT_STATES.map((option) => (
          <label key={option.value} className={styles.segment}>
            <input
              type="radio"
              name="gb-prototype-growthbot-state"
              className={styles.segmentInput}
              checked={state === option.value}
              onChange={() => setGrowthBotState(option.value)}
            />
            <span className={styles.segmentLabel}>{option.label}</span>
          </label>
        ))}
      </div>
      <Toggle
        label="Can upgrade"
        checked={canUpgrade}
        disabled={state !== "limit"}
        onChange={setGrowthBotCanUpgrade}
      />
      <Toggle
        label="Mock conversation"
        info="Opens GrowthBot onto a canned conversation (a chart, a table and a change to confirm), drawn by its real message components, to review them without the AI features. Nothing is sent to the AI service or the API."
        checked={mockConversation}
        onChange={setPrototypeMockConversation}
      />
      <button
        type="button"
        className={styles.reset}
        onClick={resetGrowthBotPrototype}
      >
        Reset
      </button>
    </fieldset>
  );
}

// Header notices (set in review): turns on fake versions of the header's
// notices (prototypeNotices.ts), fed through production's notice system
// (NoticeStack), so their treatment can be designed in context. One
// three-way choice per independent notice, and the license slot as one
// pick, as production shows one license notice at a time.
function NoticeChoice<K extends keyof PrototypeNotices>({
  noticeKey,
  label,
  options,
  value,
}: {
  noticeKey: K;
  label: string;
  options: { value: PrototypeNotices[K]; label: string }[];
  value: PrototypeNotices[K];
}) {
  return (
    <div className={styles.noticeRow}>
      <span className={styles.noticeLabel} id={`gb-proto-notice-${noticeKey}`}>
        {label}
      </span>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-labelledby={`gb-proto-notice-${noticeKey}`}
      >
        {options.map((option) => (
          <label key={String(option.value)} className={styles.segment}>
            <input
              type="radio"
              name={`gb-prototype-notice-${noticeKey}`}
              className={styles.segmentInput}
              checked={value === option.value}
              onChange={() => setPrototypeNotice(noticeKey, option.value)}
            />
            <span className={styles.segmentLabel}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const USAGE_OPTIONS: { value: UsageNoticeState; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "approaching", label: "Approaching" },
  { value: "over", label: "Over" },
];
const PAYLOAD_OPTIONS: { value: PayloadNoticeState; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "nearing", label: "Nearing" },
  { value: "over", label: "Over" },
];
const KEY_OPTIONS: { value: KeyNoticeState; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
];

function HeaderNoticeControls() {
  const notices = usePrototypeNotices();
  const currentTreatment = usePrototypeCurrentHeaderNotices();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>Header notices</legend>
      <Toggle
        label="Current product treatment"
        info="Shows the header notices as the product does today, before the redesign: the top notice as a pill, the rest behind +N. Off: the redesign's banner and notices badge."
        checked={currentTreatment}
        onChange={(v) => writeSetting(CURRENT_NOTICES_KEY, v)}
      />
      <NoticeChoice
        noticeKey="cdn"
        label="CDN usage"
        options={USAGE_OPTIONS}
        value={notices.cdn}
      />
      <NoticeChoice
        noticeKey="warehouse"
        label="Managed Warehouse usage"
        options={USAGE_OPTIONS}
        value={notices.warehouse}
      />
      <div className={styles.noticeRow}>
        <label className={styles.noticeLabel} htmlFor="gb-proto-notice-license">
          License (one at a time)
        </label>
        <select
          id="gb-proto-notice-license"
          className={styles.select}
          value={notices.license}
          onChange={(e) =>
            setPrototypeNotice("license", e.target.value as LicenseNoticeState)
          }
        >
          {LICENSE_NOTICE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <NoticeChoice
        noticeKey="payload"
        label="SDK payload size"
        options={PAYLOAD_OPTIONS}
        value={notices.payload}
      />
      <NoticeChoice
        noticeKey="pat"
        label="Personal access token"
        options={KEY_OPTIONS}
        value={notices.pat}
      />
      <NoticeChoice
        noticeKey="apiKey"
        label="API key"
        options={KEY_OPTIONS}
        value={notices.apiKey}
      />
    </fieldset>
  );
}

// Where it is, as its distance from the window's right and bottom edges
// (set in review; was its top left), so collapsing or expanding keeps its
// lower-right corner in place: it folds down into that corner.
type Position = { right: number; bottom: number };

function readPosition(): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    return value &&
      typeof value.right === "number" &&
      typeof value.bottom === "number"
      ? { right: value.right, bottom: value.bottom }
      : null;
  } catch (e) {
    return null;
  }
}

function writePosition(position: Position | null) {
  try {
    if (position) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    else localStorage.removeItem(POSITION_KEY);
  } catch (e) {
    // Storage blocked: the position lasts until the page reloads.
  }
}

// Kept on screen, the whole panel in view.
function clampPosition(position: Position, panel: HTMLElement): Position {
  const maxRight = Math.max(0, window.innerWidth - panel.offsetWidth);
  const maxBottom = Math.max(0, window.innerHeight - panel.offsetHeight);
  return {
    right: Math.min(Math.max(0, position.right), maxRight),
    bottom: Math.min(Math.max(0, position.bottom), maxBottom),
  };
}

// The position for a top-left corner at (left, top).
function fromTopLeft(left: number, top: number, panel: HTMLElement): Position {
  return {
    right: window.innerWidth - left - panel.offsetWidth,
    bottom: window.innerHeight - top - panel.offsetHeight,
  };
}

// The arrow keys' step when moving it from the keyboard (shift: 10x).
const KEY_STEP = 10;

export default function PrototypeControls() {
  const multipleOrgs = usePrototypeMultipleOrgs();
  const existingColors = usePrototypeExistingPageColors();
  const interimSettings = usePrototypeInterimSettings();
  const dockedGrowthBot = usePrototypeDockedGrowthBot();
  const showLiveChat = usePrototypeShowLiveChat();
  const liveChatInHelpSetting = useSetting(LIVE_CHAT_IN_HELP_KEY);

  useEffect(() => {
    document.documentElement.classList.toggle(
      EXISTING_COLORS_CLASS,
      existingColors,
    );
  }, [existingColors]);
  useEffect(
    () => () =>
      document.documentElement.classList.remove(EXISTING_COLORS_CLASS),
    [],
  );

  // Collapsible to its header, and movable (set in review): dragged by its
  // header, or moved with the arrow keys while the header has focus;
  // double-click the header to put it back in the lower-right corner.
  // Both are kept in this browser.
  const collapsed = useSetting(COLLAPSED_KEY);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: Position } | null>(null);
  useEffect(() => {
    setPosition(readPosition());
  }, []);
  // Back on screen if the window shrinks (or it collapses or expands).
  useEffect(() => {
    if (!position) return;
    const reclamp = () => {
      if (!panelRef.current) return;
      const next = clampPosition(position, panelRef.current);
      if (next.right !== position.right || next.bottom !== position.bottom) {
        setPosition(next);
      }
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [position, collapsed]);

  const moveTo = (next: Position, save: boolean) => {
    if (!panelRef.current) return;
    const clamped = clampPosition(next, panelRef.current);
    setPosition(clamped);
    if (save) writePosition(clamped);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      moved: fromTopLeft(rect.left, rect.top, panelRef.current),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !panelRef.current) return;
    const next = fromTopLeft(
      e.clientX - drag.current.dx,
      e.clientY - drag.current.dy,
      panelRef.current,
    );
    drag.current.moved = next;
    moveTo(next, false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    moveTo(drag.current.moved, true);
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP * 10 : KEY_STEP;
    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[e.key];
    if (!delta || !panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    moveTo(
      fromTopLeft(rect.left + delta.x, rect.top + delta.y, panelRef.current),
      true,
    );
  };
  const resetPosition = () => {
    setPosition(null);
    writePosition(null);
  };

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      role="group"
      aria-label="Prototype settings"
      style={
        position
          ? { right: position.right, bottom: position.bottom }
          : undefined
      }
    >
      <div className={styles.header}>
        <div
          className={styles.handle}
          tabIndex={0}
          role="button"
          aria-label="Move the prototype panel: drag, or use the arrow keys. Double-click to reset."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={resetPosition}
          onKeyDown={onKeyDown}
        >
          <span className={styles.title} aria-hidden="true">
            {/* "Prototype settings" (set in review; was "Prototype"),
              upper case in CSS. */}
            Prototype settings
          </span>
        </div>
        <button
          type="button"
          className={styles.collapse}
          aria-expanded={!collapsed}
          aria-controls="gb-prototype-panel-body"
          aria-label={
            collapsed
              ? "Expand prototype settings"
              : "Collapse prototype settings"
          }
          onClick={() => writeSetting(COLLAPSED_KEY, !collapsed)}
        >
          {collapsed ? (
            <PiCaretUpBold size={12} />
          ) : (
            <PiCaretDownBold size={12} />
          )}
        </button>
      </div>
      <div
        id="gb-prototype-panel-body"
        className={styles.body}
        hidden={collapsed}
      >
        <div className={styles.settings}>
          <Toggle
            label="Multiple organizations"
            checked={multipleOrgs}
            onChange={(v) => writeSetting(MULTI_ORG_KEY, v)}
          />
          <Toggle
            // "Interim colors" (set in review; was "Existing page colors").
            label="Interim colors"
            info="Shows side nav coloring and header button styling before we do a full product re-design, turn this on when viewing pages with light purple backgrounds"
            checked={existingColors}
            onChange={(v) => writeSetting(EXISTING_COLORS_KEY, v)}
          />
          <Toggle
            label="Interim settings menu"
            info="Turn this on to see how we'll treat settings before we get the full re-design in place"
            checked={interimSettings}
            onChange={(v) => writeSetting(INTERIM_SETTINGS_KEY, v)}
          />
          <Toggle
            label="Docked GrowthBot"
            info="Shows the GrowthBot drawer as a full-height right rail, with the page making room for it and the GrowthBot button at its top, instead of floating over the page. Expanding it fills the page area. On smaller screens it still floats."
            checked={dockedGrowthBot}
            onChange={(v) => writeSetting(DOCKED_GROWTHBOT_KEY, v)}
          />
        </div>
        {/* Live chat's two settings together, as GrowthBot's (set in
          review). */}
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Live chat</legend>
          <Toggle
            label="Show live chat"
            info="Shows a mock of the live chat (Pylon): a chat bubble in the lower-right corner that opens a mock chat window. Nothing is sent anywhere."
            checked={showLiveChat}
            onChange={(v) => writeSetting(SHOW_LIVE_CHAT_KEY, v)}
          />
          <Toggle
            label="In Help menu"
            info="With Show live chat on: no bubble; live chat is in the side nav's Help menu instead, with a mock unread badge on Help."
            checked={liveChatInHelpSetting}
            disabled={!showLiveChat}
            onChange={(v) => writeSetting(LIVE_CHAT_IN_HELP_KEY, v)}
          />
        </fieldset>
        {isPrototype() ? <GrowthBotControls /> : null}
        <HeaderNoticeControls />
        <button
          type="button"
          className={clsx(styles.reset, styles.resetAll)}
          onClick={resetAllSettings}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
