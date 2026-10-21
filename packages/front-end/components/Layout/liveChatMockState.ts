import { useSyncExternalStore } from "react";

// PROTOTYPE ONLY (set in review): the mock live chat's state (MockLiveChat
// .tsx), shared by its bubble and the GrowthBot panel, which take turns
// with it. Not Pylon: nothing is loaded or sent anywhere, and the real
// live-chat code (components/Auth) is untouched.
//   open - whether the mock chat window is showing

const CHANGE_EVENT = "gb-prototype-live-chat-change";
let state = { open: false };

function emit(next: Partial<typeof state>) {
  state = { ...state, ...next };
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

const SERVER_STATE = { open: false };

export function useMockLiveChat(): { open: boolean } {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}

export function openMockLiveChat() {
  emit({ open: true });
}

export function closeMockLiveChat() {
  emit({ open: false });
}

export function toggleMockLiveChat() {
  if (state.open) closeMockLiveChat();
  else openMockLiveChat();
}
