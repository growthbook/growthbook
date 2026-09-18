import type { SlackOrganizationChoice } from "back-end/src/services/slack/slackIdentity";

export type SlackResourceRef = { kind: "experiment" | "feature"; id: string };

const RESOURCE_PATHS: readonly {
  prefix: string;
  kind: SlackResourceRef["kind"];
}[] = [
  { prefix: "/experiment/", kind: "experiment" },
  { prefix: "/features/", kind: "feature" },
];

const SLACK_LINK = /<([^<>|\s]+)(?:\|[^<>]*)?>/g;

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

function toResourceRef(
  candidate: string,
  origin: string,
): SlackResourceRef | null {
  try {
    const url = new URL(candidate);
    if (url.origin !== origin) return null;

    const resource = RESOURCE_PATHS.find(({ prefix }) =>
      url.pathname.startsWith(prefix),
    );
    if (resource === undefined) return null;

    const segment = url.pathname.slice(resource.prefix.length).split("/")[0];
    if (segment === "") return null;

    return { kind: resource.kind, id: decodeURIComponent(segment) };
  } catch {
    // Slack mentions (<@U1>, <#C1|general>) and ids with broken percent escapes
    // land here; neither is a link to one of our resources.
    return null;
  }
}

export function parseSlackResourceReferences(
  text: string,
  appOrigin: string,
): SlackResourceRef[] {
  const origin = new URL(appOrigin).origin;

  const refs: SlackResourceRef[] = [];
  const seen = new Set<string>();
  for (const [, candidate] of text.matchAll(SLACK_LINK)) {
    const ref = toResourceRef(candidate, origin);
    if (ref === null) continue;

    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }

  return refs;
}

export function inferSlackOrganizationByName(
  text: string,
  choices: SlackOrganizationChoice[],
): SlackOrganizationChoice | null {
  const matched = choices.filter((choice) => {
    const name = choice.name.trim();
    if (name === "") return false;

    // \b is ASCII-only and would never fire beside the punctuation in a name
    // like "Acme, Inc.". Escaping stops at the metacharacter set because the u
    // flag rejects identity escapes such as \, and \- outright.
    const wholeWord = new RegExp(
      `(?<![\\p{L}\\p{N}_])${name.replace(REGEX_METACHARACTERS, "\\$&")}(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    return wholeWord.test(text);
  });

  return matched.length === 1 ? matched[0] : null;
}
