import { FormEvent, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  PiCaretDownBold,
  PiChatTeardropDotsFill,
  PiPaperPlaneRightFill,
  PiXBold,
} from "react-icons/pi";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import { usePrototypeShowLiveChat } from "./PrototypeControls";
import {
  closeMockLiveChat,
  toggleMockLiveChat,
  useMockLiveChat,
} from "./liveChatMockState";
import styles from "./MockLiveChat.module.scss";

// PROTOTYPE ONLY (set in review): a mock of the live chat (Pylon), for
// reviewers to see where it lives beside the docked GrowthBot panel.
// Nothing is loaded from Pylon or sent anywhere; the
// real live chat (components/Auth/InAppHelp.tsx, PylonChatVisibility.tsx)
// is untouched. With "Show live chat" on (PrototypeControls.tsx):
// - The bubble: a 56px round button in the lower-right corner, 20px in, as
//   Pylon's. It hides while GrowthBot is open, as the real one does, and
//   while it's open, shows a caret to close the window (Pylon's pattern).
// - The window: 380 × 560px (shorter in a short window), above the bubble,
//   or in the corner without it, as Pylon's.
// - With GrowthBot: one at a time. Opening the chat closes the GrowthBot
//   panel, and opening GrowthBot closes the chat, so they never stack in
//   the same corner; the last one opened wins.

type Message = { id: number; from: "support" | "user"; text: string };

const GREETING: Message[] = [
  {
    id: 1,
    from: "support",
    text: "Hi there 👋 Thanks for reaching out to GrowthBook support.",
  },
  {
    id: 2,
    from: "support",
    text: "Ask us anything about your account, experiments or SDKs, and a teammate will reply here.",
  },
];

const MOCK_REPLY =
  "Thanks! This is a mock of live chat for the prototype, so no one will reply here.";

export default function MockLiveChat() {
  const show = usePrototypeShowLiveChat();
  const { open } = useMockLiveChat();
  const { open: agentOpen, closePanel } = useAgentPanel();

  // Off, or switched off while open: closed.
  useEffect(() => {
    if (!show && open) closeMockLiveChat();
  }, [show, open]);

  // One at a time with GrowthBot (above). Each runs only when its own side
  // changes, so the one just opened wins.
  useEffect(() => {
    if (open && agentOpen) closePanel();
    // Only when the chat opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (agentOpen && open) closeMockLiveChat();
    // Only when GrowthBot opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOpen]);

  if (!show) return null;
  const showBubble = !agentOpen;

  return (
    <>
      {showBubble ? (
        <button
          type="button"
          className={styles.bubble}
          onClick={toggleMockLiveChat}
          aria-label={open ? "Close live chat" : "Open live chat"}
          aria-expanded={open}
          aria-controls="gb-mock-live-chat"
        >
          {open ? (
            <PiCaretDownBold size={22} aria-hidden="true" />
          ) : (
            <PiChatTeardropDotsFill size={26} aria-hidden="true" />
          )}
        </button>
      ) : null}
      {open ? <ChatWindow aboveBubble={showBubble} /> : null}
    </>
  );
}

function ChatWindow({ aboveBubble }: { aboveBubble: boolean }) {
  const [messages, setMessages] = useState<Message[]>(GREETING);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const replyTimer = useRef<number | null>(null);

  // Focus into the message box on open, and back where it was on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (replyTimer.current) window.clearTimeout(replyTimer.current);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  // Escape closes it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMockLiveChat();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setMessages((m) => [...m, { id: Date.now(), from: "user", text }]);
    // One canned reply, a moment later, saying it's a mock.
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    replyTimer.current = window.setTimeout(() => {
      setMessages((m) => [
        ...m,
        { id: Date.now() + 1, from: "support", text: MOCK_REPLY },
      ]);
    }, 900);
  };

  return (
    <div
      id="gb-mock-live-chat"
      role="dialog"
      aria-label="Live chat with GrowthBook support (mock)"
      className={clsx(styles.window, aboveBubble && styles.aboveBubble)}
    >
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.title}>GrowthBook Support</div>
          <div className={styles.subtitle}>
            <span className={styles.onlineDot} aria-hidden="true" />
            We typically reply in a few minutes
          </div>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={closeMockLiveChat}
          aria-label="Close live chat"
        >
          <PiXBold size={16} aria-hidden="true" />
        </button>
      </div>

      <div
        ref={listRef}
        className={styles.messages}
        role="log"
        aria-live="polite"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={clsx(
              styles.message,
              m.from === "user" ? styles.fromUser : styles.fromSupport,
            )}
          >
            {m.text}
          </div>
        ))}
      </div>

      <form className={styles.composer} onSubmit={send}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          placeholder="Write a message…"
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
        />
        <button
          type="submit"
          className={styles.send}
          disabled={!draft.trim()}
          aria-label="Send message"
        >
          <PiPaperPlaneRightFill size={16} aria-hidden="true" />
        </button>
      </form>
      <div className={styles.footnote}>Prototype mock: nothing is sent.</div>
    </div>
  );
}
