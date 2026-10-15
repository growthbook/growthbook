import type { AIChatMessage } from "shared/ai-chat";
import { getApiHost } from "@/services/env";

// PROTOTYPE ONLY. With NEXT_PUBLIC_PROTOTYPE_AI=true (pages/api/init.ts),
// the AI Assistant drawer runs without an AI backend: this answers its
// /agent/... requests in the browser, so nothing reaches the server.
//
// - POST /agent/chat streams a canned reply (the drawer's own SSE events,
//   text-delta then done) after about a second, a few words at a time.
//   Asking for a table, chart, data or numbers gets a reply with a markdown
//   table, which the drawer renders. Its exploration charts need a real
//   query result, so they aren't stubbed.
// - The conversation is kept in memory (until the page reloads), so the
//   drawer's reload after each reply (GET /agent/chat/:id) and its history
//   list (GET /agent/chat) work.
// - Cancel and feedback succeed; skills are an empty list; anything else
//   under /agent/ returns {}.
//
// Installed once, from AgentPanelProvider, only while the flag is on.

type Conversation = {
  id: string;
  createdAt: number;
  messages: AIChatMessage[];
};

const conversations = new Map<string, Conversation>();
let installed = false;
let replyCount = 0;

const FIRST_TOKEN_DELAY_MS = 1000;
const TOKEN_INTERVAL_MS = 35;

const TABLE_REPLY = `Here's a quick look at your most recent experiments (prototype data):

| Experiment | Status | Variations | Users | Lift |
| --- | --- | --- | ---: | ---: |
| Checkout button color | Running | 2 | 48,210 | +3.4% |
| Onboarding checklist | Running | 3 | 22,904 | +1.1% |
| Pricing page layout | Stopped | 2 | 61,377 | −0.6% |
| Search autocomplete | Draft | 2 | — | — |

**Checkout button color** is trending positive. Want me to check whether it has reached significance?`;

const TEXT_REPLIES = [
  `Happy to help! I'm running in **prototype mode**, so these replies are canned, but the drawer, streaming and history all work as they do with the real assistant.

Try asking me for a **table** of your experiments to see how richer answers look.`,
  `Good question. In the real product I'd look this up across your experiments, feature flags and metrics, and link you to what I find.

For now, here's the shape of an answer:
- A short summary up top
- The key numbers
- A suggested next step`,
  `Got it. A few things I can help with once connected:

1. Summarize how an experiment is performing
2. Explain why a metric moved
3. Draft a hypothesis or a feature flag rule

(Prototype reply.)`,
];

function wantsTable(message: string): boolean {
  return /\b(table|chart|graph|data|numbers?|results?|stats)\b/i.test(message);
}

function pickReply(message: string): string {
  if (wantsTable(message)) return TABLE_REPLY;
  const reply = TEXT_REPLIES[replyCount % TEXT_REPLIES.length];
  replyCount++;
  return reply;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// The reply in small pieces, words with their following spaces, as a model
// would stream it.
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function streamReply(
  body: { message?: unknown; conversationId?: unknown },
  signal?: AbortSignal | null,
): Response {
  const message = typeof body.message === "string" ? body.message : "";
  const cid =
    typeof body.conversationId === "string" && body.conversationId
      ? body.conversationId
      : `prototype_${Date.now()}`;
  const conversation = conversations.get(cid) ?? {
    id: cid,
    createdAt: Date.now(),
    messages: [],
  };
  conversations.set(cid, conversation);
  const now = Date.now();
  conversation.messages.push({
    role: "user",
    id: `proto_user_${now}`,
    ts: now,
    content: message,
  });

  const reply = pickReply(message);
  const encoder = new TextEncoder();
  let streamed = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await wait(FIRST_TOKEN_DELAY_MS, signal);
        for (const token of tokenize(reply)) {
          streamed += token;
          controller.enqueue(
            encoder.encode(sse("text-delta", { content: token })),
          );
          await wait(TOKEN_INTERVAL_MS, signal);
        }
        controller.enqueue(encoder.encode(sse("done", {})));
        controller.close();
      } catch (e) {
        controller.error(e);
      } finally {
        // Keep what was said, as the server persists a cancelled turn.
        if (streamed) {
          conversation.messages.push({
            role: "assistant",
            id: `proto_assistant_${Date.now()}`,
            ts: Date.now(),
            content: streamed,
          });
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function summaries() {
  return [...conversations.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((c) => {
      const first = c.messages.find((m) => m.role === "user");
      const preview =
        first && typeof first.content === "string"
          ? first.content.slice(0, 120)
          : "";
      return {
        conversationId: c.id,
        title: preview.slice(0, 60) || "New chat",
        createdAt: c.createdAt,
        messageCount: c.messages.length,
        isStreaming: false,
        preview,
      };
    });
}

async function readJson(init?: RequestInit): Promise<Record<string, unknown>> {
  if (typeof init?.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// The /agent/... path of a request to the API host, or null for any other.
function agentPath(input: RequestInfo | URL): string | null {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const host = getApiHost();
  if (!url.startsWith(host)) return null;
  const path = url.slice(host.length).split("?")[0];
  return path.startsWith("/agent/") || path === "/agent" ? path : null;
}

async function handle(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();

  if (path === "/agent/chat") {
    if (method === "POST")
      return streamReply(await readJson(init), init?.signal);
    return jsonResponse({ conversations: summaries() });
  }

  const conversationMatch = path.match(/^\/agent\/chat\/([^/]+)$/);
  if (conversationMatch) {
    const conversation = conversations.get(conversationMatch[1]);
    return jsonResponse({
      messages: conversation?.messages ?? [],
      isStreaming: false,
      lastStreamedAt: Date.now(),
      pendingAction: null,
    });
  }

  if (/^\/agent\/chat\/[^/]+\/(cancel|feedback)$/.test(path)) {
    return jsonResponse({ status: 200 });
  }

  if (path === "/agent/skills") return jsonResponse({ skills: [] });

  return jsonResponse({});
}

export function installPrototypeAIStub(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = agentPath(input);
    return path ? handle(path, init) : realFetch(input, init);
  };
}
