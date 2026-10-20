import { useSyncExternalStore } from "react";
import { isPrototype } from "@/services/env";

// PROTOTYPE ONLY (set in review): "Mock conversation", in the prototype
// panel's GrowthBot section (PrototypeControls.tsx), with
// NEXT_PUBLIC_PROTOTYPE=true. On, the GrowthBot drawer opens onto a canned
// conversation (prototypeMockChat.ts), drawn by its real message and card
// components, for reviewing them without the AI features (on the panel's
// usual colour: white with "Interim colors" on, grey with it off): the drawer is
// available, its /agent/... requests are answered in the browser
// (prototypeAIStub.ts), and nothing reaches the AI service or the API. Off,
// the drawer behaves as before. Kept in this browser (localStorage).

const KEY = "gb-prototype-growthbot-mock-chat";
const CHANGE_EVENT = "gb-prototype-growthbot-mock-chat-change";

function read(): boolean {
  if (!isPrototype()) return false;
  try {
    return localStorage.getItem(KEY) === "true";
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

export function usePrototypeMockConversation(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

// Read outside React (the fetch stub, at request time).
export function isPrototypeMockConversation(): boolean {
  return typeof window !== "undefined" && read();
}

export function setPrototypeMockConversation(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "true");
    else localStorage.removeItem(KEY);
  } catch (e) {
    // Storage blocked: it stays off.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// The drawer's conversation for this tab (AgentPanel.tsx's STORAGE_KEY, in
// sessionStorage, read once when the drawer mounts): the mock's while it's
// on, and cleared when it goes off, so the drawer starts a new chat rather
// than asking the real API for the mock. AgentLauncher remounts the drawer
// as it changes, so it's read again.
const CONVERSATION_KEY = "growthbook.agent.conversationId";

export function syncMockConversationId(
  // As the drawer builds its key, so the same when either is missing.
  orgId: string | undefined,
  userId: string | undefined,
  on: boolean,
  mockId: string,
) {
  if (typeof window === "undefined") return;
  const key = `${CONVERSATION_KEY}:${orgId}:${userId}`;
  try {
    if (on) sessionStorage.setItem(key, mockId);
    else if (sessionStorage.getItem(key) === mockId)
      sessionStorage.removeItem(key);
  } catch (e) {
    // Storage blocked: the drawer starts a new chat.
  }
}
