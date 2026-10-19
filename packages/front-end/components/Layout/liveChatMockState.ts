import { useSyncExternalStore } from "react";

// PROTOTYPE ONLY (set in review): the mock live chat's state (MockLiveChat
// .tsx), shared by its bubble, the side nav's Help menu and the GrowthBot
// panel, which take turns with it. Not Pylon: nothing is loaded or sent
// anywhere, and the real live-chat code (components/Auth) is untouched.
//   open   - whether the mock chat window is showing
//   unread - a fake unread count for the Help badge; it clears when the
//            window opens and comes back on the next page load

const CHANGE_EVENT = "gb-prototype-live-chat-change";
export const MOCK_UNREAD_COUNT = 2;

let state = { open: false, unread: MOCK_UNREAD_COUNT };

function emit(next: Partial<typeof state>) {
  state = { ...state, ...next };
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

const SERVER_STATE = { open: false, unread: MOCK_UNREAD_COUNT };

export function useMockLiveChat(): { open: boolean; unread: number } {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}

// Opening reads the messages, so the unread count clears.
export function openMockLiveChat() {
  emit({ open: true, unread: 0 });
}

export function closeMockLiveChat() {
  emit({ open: false });
}

export function toggleMockLiveChat() {
  if (state.open) closeMockLiveChat();
  else openMockLiveChat();
}
