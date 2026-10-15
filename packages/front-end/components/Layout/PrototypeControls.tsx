import { useSyncExternalStore } from "react";
import styles from "./PrototypeControls.module.scss";

// PROTOTYPE ONLY (set in review): a panel of prototype settings, in the
// lower-right corner, styled apart from the product (dark, monospace,
// dashed outline) so it doesn't read as part of the UI. Each setting is
// kept in this browser (localStorage) and shared through the hook below.

const MULTI_ORG_KEY = "gb-prototype-multiple-orgs";
const CHANGE_EVENT = "gb-prototype-settings-change";

function readMultiOrg(): boolean {
  try {
    return localStorage.getItem(MULTI_ORG_KEY) === "true";
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

function setMultiOrg(value: boolean) {
  try {
    localStorage.setItem(MULTI_ORG_KEY, value ? "true" : "false");
  } catch (e) {
    // Storage blocked: the setting lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// "Multiple organizations": the profile menu acts as if the user is in
// several organizations (ProfileMenu.tsx). Off on the server.
export function usePrototypeMultipleOrgs(): boolean {
  return useSyncExternalStore(subscribe, readMultiOrg, () => false);
}

export default function PrototypeControls() {
  const multipleOrgs = usePrototypeMultipleOrgs();
  return (
    <div className={styles.panel} role="group" aria-label="Prototype settings">
      <div className={styles.title} aria-hidden="true">
        Prototype
      </div>
      <label className={styles.setting}>
        <input
          type="checkbox"
          role="switch"
          className={styles.switchInput}
          checked={multipleOrgs}
          onChange={(e) => setMultiOrg(e.target.checked)}
        />
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchThumb} />
        </span>
        Multiple organizations
      </label>
    </div>
  );
}
