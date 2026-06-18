import { fetch } from "back-end/src/util/http.util";
import { KAPA_AI_API_KEY, KAPA_AI_MCP_URL } from "back-end/src/util/secrets";

// Documentation search backed by Kapa.ai's GrowthBook MCP server. We talk to
// it over raw JSON-RPC-over-HTTP rather than pulling in an MCP client library —
// the surface we need is a single `tools/call`, so a hand-rolled POST keeps the
// dependency footprint at zero. See the searchDocs tool in general-agent.ts.

const KAPA_MCP_TOOL_NAME = "search_growth_book_knowledge_sources";

export type KapaSource = { url: string; content: string };

/** True when the searchDocs tool can run — i.e. Kapa is configured. */
export function isKapaConfigured(): boolean {
  return !!KAPA_AI_API_KEY;
}

/**
 * Parse the `content` blocks of an MCP `tools/call` result into sources.
 * Each text block may itself be a JSON object with `source_url` + `content`,
 * or just plain text. Pure function — unit tested in kapa.test.ts.
 */
export function parseKapaContentBlocks(content: unknown[]): KapaSource[] {
  const sources: KapaSource[] = [];
  for (const block of content) {
    if (
      typeof block !== "object" ||
      block === null ||
      !("type" in block) ||
      (block as { type: string }).type !== "text" ||
      !("text" in block)
    ) {
      continue;
    }

    const text = (block as { text: string }).text;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "source_url" in parsed
      ) {
        const p = parsed as { source_url?: string; content?: string };
        sources.push({ url: p.source_url || "", content: p.content || text });
        continue;
      }
    } catch {
      // not JSON — treat as plain text
    }
    sources.push({ url: "", content: text });
  }
  return sources;
}

/**
 * Extract the JSON-RPC payload from a Kapa MCP response, which may arrive as
 * plain JSON or as an SSE (`text/event-stream`) body. Returns the parsed
 * envelope or undefined if nothing parseable was found.
 */
async function readMcpResponse(
  response: Awaited<ReturnType<typeof fetch>>,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    // MCP may respond with SSE — find the first data line with a JSON-RPC body.
    const text = await response.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ") && line.length > 6) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // keep scanning
        }
      }
    }
    return undefined;
  }
  return response.json();
}

/**
 * Search the GrowthBook documentation + community Q&A via Kapa's MCP server.
 * Callers must check isKapaConfigured() first; this throws on transport errors
 * so the tool layer can surface a graceful fallback message.
 */
export async function searchKapaDocumentation(
  query: string,
): Promise<{ sources: KapaSource[] }> {
  const response = await fetch(KAPA_AI_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KAPA_AI_API_KEY}`,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: KAPA_MCP_TOOL_NAME,
        arguments: { query },
      },
      id: 1,
    }),
  });

  const data = await readMcpResponse(response);
  const result = (
    data as { result?: { content?: unknown[]; isError?: boolean } } | undefined
  )?.result;
  if (!result?.content) return { sources: [] };

  // Kapa signals a tool-level failure (e.g. unknown tool name) with isError;
  // the content holds the error message, not real sources. Surface it as a
  // throw so the tool layer logs it and falls back, rather than parsing the
  // error text into a bogus source.
  if (result.isError) {
    const blocks = parseKapaContentBlocks(result.content);
    const detail = blocks.map((b) => b.content).join(" ") || "unknown error";
    throw new Error(`Kapa MCP tool error: ${detail}`);
  }

  return { sources: parseKapaContentBlocks(result.content) };
}
