import { AES, enc } from "crypto-js";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import {
  ENCRYPTION_KEY,
  FIGMA_OAUTH_CLIENT_ID,
  FIGMA_OAUTH_CLIENT_SECRET,
} from "back-end/src/util/secrets";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

type Context = ReqContext | ApiReqContext;

// OAuth scope needed to read file contents + render node images. Figma's
// newer granular-scopes model calls this `file_content:read`; older apps
// used `files:read`. Adjust when registering the Figma OAuth app.
export const FIGMA_OAUTH_SCOPE = "file_content:read";

const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const FIGMA_REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";
const FIGMA_AUTHORIZE_URL = "https://www.figma.com/oauth";

// Refresh a little before the real expiry so an in-flight request doesn't
// race the clock.
const EXPIRY_SKEW_MS = 60_000;

export function figmaOAuthConfigured(): boolean {
  return !!(FIGMA_OAUTH_CLIENT_ID && FIGMA_OAUTH_CLIENT_SECRET);
}

export function getFigmaClientId(): string {
  return FIGMA_OAUTH_CLIENT_ID;
}

// Fall back to a week when Figma omits expires_in, so we don't treat the
// token as already expired and refresh on every call.
const DEFAULT_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
function computeExpiresAt(expiresIn?: number): number {
  return Date.now() + (expiresIn ?? DEFAULT_TOKEN_TTL_SEC) * 1000;
}

// ---- token encryption (at rest) ----
function encryptToken(plaintext: string): string {
  return AES.encrypt(plaintext, ENCRYPTION_KEY).toString();
}
function decryptToken(ciphertext: string): string {
  return AES.decrypt(ciphertext, ENCRYPTION_KEY).toString(enc.Utf8);
}

// ---- authorize URL ----
export function buildFigmaAuthorizeUrl({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: FIGMA_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: FIGMA_OAUTH_SCOPE,
    state,
    response_type: "code",
  });
  return `${FIGMA_AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const raw = `${FIGMA_OAUTH_CLIENT_ID}:${FIGMA_OAUTH_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

type FigmaTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  message?: string;
};

// ---- OAuth code exchange ----
async function postFigmaForm(
  url: string,
  body: Record<string, string>,
): Promise<FigmaTokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as FigmaTokenResponse;
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(
      `Figma OAuth request failed: ${
        json.error || json.message || res.statusText
      }`,
    );
  }
  return json;
}

export async function exchangeFigmaCode({
  context,
  code,
  redirectUri,
}: {
  context: Context;
  code: string;
  redirectUri: string;
}): Promise<void> {
  if (!figmaOAuthConfigured()) {
    throw new Error(
      "Figma is not configured for this GrowthBook instance. Ask an admin to set FIGMA_OAUTH_CLIENT_ID / FIGMA_OAUTH_CLIENT_SECRET.",
    );
  }
  if (!context.userId) {
    throw new Error("A user is required to connect Figma.");
  }
  const json = await postFigmaForm(FIGMA_TOKEN_URL, {
    redirect_uri: redirectUri,
    code,
    grant_type: "authorization_code",
  });
  await storeTokens(context, json);
}

async function storeTokens(
  context: Context,
  json: FigmaTokenResponse,
): Promise<void> {
  await context.models.figmaConnections.upsertForUser(context.userId, {
    accessToken: encryptToken(json.access_token || ""),
    refreshToken: encryptToken(json.refresh_token || ""),
    expiresAt: computeExpiresAt(json.expires_in),
  });
}

// Returns a live access token for the current user, refreshing it when it
// has (nearly) expired. Throws a typed error when no connection exists so
// the extension can prompt the user to (re)connect.
export class FigmaNotConnectedError extends Error {
  constructor() {
    super(
      "Not connected to Figma. Connect your Figma account in the visual editor settings and try again.",
    );
    this.name = "FigmaNotConnectedError";
  }
}

export async function getValidFigmaAccessToken(
  context: Context,
): Promise<string> {
  if (!context.userId) throw new FigmaNotConnectedError();
  const conn = await context.models.figmaConnections.getByUserId(
    context.userId,
  );
  if (!conn) throw new FigmaNotConnectedError();

  if (conn.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return decryptToken(conn.accessToken);
  }

  // Expired (or about to) — refresh.
  const refreshToken = decryptToken(conn.refreshToken);
  if (!refreshToken) throw new FigmaNotConnectedError();
  const json = await postFigmaForm(FIGMA_REFRESH_URL, {
    refresh_token: refreshToken,
  });
  await context.models.figmaConnections.upsertForUser(context.userId, {
    accessToken: encryptToken(json.access_token || ""),
    // Figma's refresh response may omit refresh_token; keep the existing one.
    refreshToken: encryptToken(json.refresh_token || refreshToken),
    expiresAt: computeExpiresAt(json.expires_in),
  });
  return json.access_token || "";
}

export async function disconnectFigma(context: Context): Promise<void> {
  if (!context.userId) return;
  await context.models.figmaConnections.deleteForUser(context.userId);
}

export async function isFigmaConnected(context: Context): Promise<{
  connected: boolean;
  expiresAt: number | null;
}> {
  if (!context.userId) return { connected: false, expiresAt: null };
  const conn = await context.models.figmaConnections.getByUserId(
    context.userId,
  );
  if (!conn) return { connected: false, expiresAt: null };
  // Resolve a live token (refreshing if the access token has expired) so a
  // record with a dead/unrefreshable token reports connected:false rather
  // than a stale "Connected".
  try {
    await getValidFigmaAccessToken(context);
    return { connected: true, expiresAt: conn.expiresAt };
  } catch {
    return { connected: false, expiresAt: conn.expiresAt };
  }
}

// ---- Figma frame URL parsing ----
// Frame URLs look like:
//   https://www.figma.com/design/<fileKey>/<name>?node-id=12-345&...
//   https://www.figma.com/file/<fileKey>/<name>?node-id=12%3A345
// The node-id query param uses "-" as the separator in the URL; the REST
// API expects ":" (e.g. 12:345).
export function parseFigmaFrameUrl(
  url: string,
): { fileKey: string; nodeId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(parsed.hostname)) return null;

  const m = parsed.pathname.match(/\/(?:file|design|proto)\/([^/]+)/);
  const fileKey = m?.[1];
  if (!fileKey) return null;

  const rawNode = parsed.searchParams.get("node-id");
  if (!rawNode) return null;
  // Normalize "12-345" → "12:345" (already-encoded ":" survives decoding).
  const nodeId = rawNode.includes(":") ? rawNode : rawNode.replace(/-/g, ":");
  return { fileKey, nodeId };
}

// Bound SSRF: only download rendered images from Figma-controlled hosts.
function isAllowedFigmaImageHost(host: string): boolean {
  if (/(^|\.)figma\.com$/.test(host)) return true;
  // Figma renders are also served from its S3 buckets (figma-prefixed).
  if (/(^|\.)amazonaws\.com$/.test(host) && /^figma[.-]/.test(host)) {
    return true;
  }
  return false;
}

// ---- render a node to PNG ----
export async function renderFigmaNodeImage({
  accessToken,
  fileKey,
  nodeId,
}: {
  accessToken: string;
  fileKey: string;
  nodeId: string;
}): Promise<{ data: string; mimeType: "image/png" }> {
  const params = new URLSearchParams({
    ids: nodeId,
    format: "png",
    scale: "2",
  });
  const res = await fetch(
    `https://api.figma.com/v1/images/${encodeURIComponent(
      fileKey,
    )}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = (await res.json()) as {
    err?: string | null;
    images?: Record<string, string | null>;
  };
  if (!res.ok || json.err) {
    throw new Error(`Figma image render failed: ${json.err || res.statusText}`);
  }
  const imageUrl = json.images?.[nodeId];
  if (!imageUrl) {
    throw new Error(
      "Figma couldn't render that frame. Make sure the link points to a specific frame and you have access to it.",
    );
  }

  let imageHost: string;
  try {
    imageHost = new URL(imageUrl).hostname;
  } catch {
    throw new Error("Figma returned an invalid image URL.");
  }
  if (!isAllowedFigmaImageHost(imageHost)) {
    throw new Error("Figma returned an image from an unexpected host.");
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error("Failed to download the rendered Figma image.");
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return { data: buf.toString("base64"), mimeType: "image/png" };
}

// ---- node tree → compact design-token summary ----
// The full node JSON is huge; condense it to the high-signal tokens that
// improve fidelity (exact colors, fonts, text, frame size) without
// blowing the prompt budget. Exported for unit testing.
type FigmaPaint = {
  type?: string;
  color?: { r: number; g: number; b: number; a?: number };
  opacity?: number;
};
type FigmaNode = {
  type?: string;
  name?: string;
  characters?: string;
  fills?: FigmaPaint[];
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
  };
  absoluteBoundingBox?: { width?: number; height?: number };
  children?: FigmaNode[];
};

function rgbaToHex(c: { r: number; g: number; b: number; a?: number }): string {
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const hex = (v: number) => to255(v).toString(16).padStart(2, "0");
  const base = `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  return c.a != null && c.a < 1 ? `${base} (${Math.round(c.a * 100)}%)` : base;
}

export function summarizeFigmaNode(root: FigmaNode): string {
  const MAX_COLORS = 12;
  const MAX_TEXTS = 30;
  const MAX_NODES = 4000;

  const colors = new Set<string>();
  const fonts = new Set<string>();
  const texts: string[] = [];
  let dims: { width?: number; height?: number } | undefined;

  let visited = 0;
  const walk = (node: FigmaNode) => {
    if (!node || visited >= MAX_NODES) return;
    visited++;

    if (!dims && node.absoluteBoundingBox) dims = node.absoluteBoundingBox;

    if (Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill?.type === "SOLID" && fill.color && colors.size < MAX_COLORS) {
          colors.add(rgbaToHex(fill.color));
        }
      }
    }

    if (node.type === "TEXT") {
      if (node.style?.fontFamily) {
        const weight = node.style.fontWeight ? ` ${node.style.fontWeight}` : "";
        const size = node.style.fontSize ? ` ${node.style.fontSize}px` : "";
        fonts.add(`${node.style.fontFamily}${weight}${size}`);
      }
      const text = (node.characters || "").trim();
      if (text && texts.length < MAX_TEXTS) {
        texts.push(text.length > 120 ? `${text.slice(0, 117)}…` : text);
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(root);

  const lines: string[] = [];
  if (dims?.width && dims?.height) {
    lines.push(
      `Frame size: ${Math.round(dims.width)}×${Math.round(dims.height)}px`,
    );
  }
  if (colors.size) lines.push(`Colors: ${[...colors].join(", ")}`);
  if (fonts.size) lines.push(`Fonts: ${[...fonts].join("; ")}`);
  if (texts.length) {
    lines.push("Text content:");
    for (const t of texts) lines.push(`- ${t}`);
  }
  return lines.join("\n");
}

export async function getFigmaNodeTokenSummary({
  accessToken,
  fileKey,
  nodeId,
}: {
  accessToken: string;
  fileKey: string;
  nodeId: string;
}): Promise<string> {
  try {
    const params = new URLSearchParams({ ids: nodeId });
    const res = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(
        fileKey,
      )}/nodes?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return "";
    const json = (await res.json()) as {
      nodes?: Record<string, { document?: FigmaNode } | null>;
    };
    const doc = json.nodes?.[nodeId]?.document;
    if (!doc) return "";
    return summarizeFigmaNode(doc);
  } catch (err) {
    // The token summary is a best-effort fidelity boost — the rendered
    // image is the primary signal, so a nodes-API hiccup shouldn't fail
    // the whole request.
    logger.warn({ err }, "[figma] failed to summarize node tokens");
    return "";
  }
}
