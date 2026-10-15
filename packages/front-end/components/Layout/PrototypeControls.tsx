import { useEffect, useSyncExternalStore } from "react";
import styles from "./PrototypeControls.module.scss";

// PROTOTYPE ONLY (set in review): a panel of prototype settings, in the
// lower-right corner, styled apart from the product (dark, monospace,
// dashed outline) so it doesn't read as part of the UI. Each setting is
// kept in this browser (localStorage) and shared through the hooks below.

const MULTI_ORG_KEY = "gb-prototype-multiple-orgs";
const EXISTING_COLORS_KEY = "gb-prototype-existing-page-colors";
const CHANGE_EVENT = "gb-prototype-settings-change";
// On <html> while "Existing page colors" is on, for the header's and side
// nav's styles (TopNav.module.scss).
export const EXISTING_COLORS_CLASS = "prototype-existing-page-colors";

function readSetting(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch (e) {
    return false;
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

function useSetting(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readSetting(key),
    () => false,
  );
}

// "Multiple organizations": the profile menu acts as if the user is in
// several organizations (ProfileMenu.tsx). Off on the server.
export function usePrototypeMultipleOrgs(): boolean {
  return useSetting(MULTI_ORG_KEY);
}

// "Existing page colors": the header and side nav take the existing
// product pages' colours (the light purple page background) instead of the
// redesign's white, to demo them beside pages not yet redesigned.
export function usePrototypeExistingPageColors(): boolean {
  return useSetting(EXISTING_COLORS_KEY);
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.setting}>
      <input
        type="checkbox"
        role="switch"
        className={styles.switchInput}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      {label}
    </label>
  );
}

export default function PrototypeControls() {
  const multipleOrgs = usePrototypeMultipleOrgs();
  const existingColors = usePrototypeExistingPageColors();

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

  return (
    <div className={styles.panel} role="group" aria-label="Prototype settings">
      <div className={styles.title} aria-hidden="true">
        Prototype
      </div>
      <div className={styles.settings}>
        <Toggle
          label="Multiple organizations"
          checked={multipleOrgs}
          onChange={(v) => writeSetting(MULTI_ORG_KEY, v)}
        />
        <Toggle
          label="Existing page colors"
          checked={existingColors}
          onChange={(v) => writeSetting(EXISTING_COLORS_KEY, v)}
        />
      </div>
    </div>
  );
}
