#!/usr/bin/env node
/**
 * Snapshot open (and recently merged) PRs for the experiment-squad review board.
 *
 * Scope: entire GitHub org `growthbook` (every repository), not a single repo.
 *
 * Inclusion (same rules across all org repos):
 * - Open PRs authored by experiment-squad members (+ optional extra authors)
 * - Recently merged PRs by those authors (last 14 days)
 * - Open PRs with a team review request for experiment-squad
 *   (GitHub team slug; sometimes referred to as "experimentation-squad")
 *
 * Usage:
 *   node scripts/fetch-exp-squad-prs.mjs
 *   node scripts/fetch-exp-squad-prs.mjs --out /tmp/squad-prs.json
 *   node scripts/fetch-exp-squad-prs.mjs --team-only --out /tmp/squad-prs-team-only.json
 *
 * Requires `gh` auth with org read access.
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";

const TEAM_SLUG = "experiment-squad";
const ORG = "growthbook";
/** Per-search page size; org-wide author queues can exceed 50. */
const OPEN_LIMIT = 100;
const MERGED_LIMIT = 50;

const members = [
  "ahdriel",
  "lukesonnet",
  "teresayung",
  "msamper",
  "lukebrawleysmith",
  "lillialjackson",
];
const extraAuthors = ["gabebook340"];
const authors = [...members, ...extraAuthors];

const BOTS = new Set([
  "github-actions",
  "github-actions[bot]",
  "dependabot",
  "dependabot[bot]",
  "renovate",
  "renovate[bot]",
  "cursor",
  "cursor[bot]",
  "copilot-pull-request-reviewer",
  "copilot-pull-request-reviewer[bot]",
  "greptile-apps",
  "greptile-apps[bot]",
]);

function isBot(login) {
  if (!login) return true;
  const s = String(login);
  if (BOTS.has(s)) return true;
  if (s.includes("[bot]")) return true;
  return false;
}

function ghJson(args) {
  const out = execSync(`gh ${args}`, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function parseArgs(argv) {
  let out = "/tmp/squad-prs.json";
  let teamOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--team-only") {
      teamOnly = true;
    }
  }
  return { out, teamOnly };
}

const { out: outPath, teamOnly } = parseArgs(process.argv.slice(2));

const fields =
  "number,title,url,createdAt,updatedAt,state,isDraft,author,repository,assignees";

// `--owner ${ORG}` searches every repository in the growthbook org.
const openPrs = [];
if (!teamOnly) {
  for (const author of authors) {
    const rows = ghJson(
      `search prs --owner ${ORG} --author ${author} --state open --limit ${OPEN_LIMIT} --json ${fields}`
    );
    openPrs.push(...rows);
  }
}

// Team review requests (may include external authors not in the squad list).
const teamRequested = ghJson(
  `search prs --owner ${ORG} --state open --limit ${OPEN_LIMIT} --json ${fields} -- "team-review-requested:${ORG}/${TEAM_SLUG}"`
);
for (const pr of teamRequested) {
  openPrs.push(pr);
}

const mergedPrs = [];
if (!teamOnly) {
  for (const author of authors) {
    try {
      const rows = ghJson(
        `search prs --owner ${ORG} --author ${author} --merged --limit ${MERGED_LIMIT} --json ${fields}`
      );
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      mergedPrs.push(
        ...rows.filter((p) => new Date(p.updatedAt).getTime() >= cutoff)
      );
    } catch {
      // ignore per-author merge search failures
    }
  }
}

const byUrl = new Map();
for (const pr of [...openPrs, ...mergedPrs]) byUrl.set(pr.url, pr);
const prs = [...byUrl.values()];

const detailed = [];
for (const pr of prs) {
  const full = pr.repository.nameWithOwner;
  const [o, r] = full.split("/");
  const authorLogin = pr.author?.login;
  let assignees = (pr.assignees || []).map((a) =>
    typeof a === "string"
      ? { login: a }
      : { login: a.login || a.name || String(a) }
  );
  let requestedReviewers = [];
  let requestedTeams = [];
  let reviews = [];
  let commentUsers = [];
  let merged = pr.state === "merged" || pr.state === "MERGED";
  let closed = false;
  let isDraft = !!pr.isDraft;

  try {
    const data = ghJson(`api repos/${o}/${r}/pulls/${pr.number}`);
    assignees = (data.assignees || []).map((a) => ({
      login: a.login,
      avatarUrl: a.avatar_url,
      url: a.html_url,
    }));
    requestedTeams = (data.requested_teams || []).map((t) => t.slug);
    requestedReviewers = [
      ...(data.requested_reviewers || []).map((u) => u.login),
      ...requestedTeams.map((slug) => `team:${slug}`),
    ];
    merged = !!data.merged;
    closed = data.state === "closed" && !data.merged;
    isDraft = !!data.draft;
    reviews = ghJson(`api repos/${o}/${r}/pulls/${pr.number}/reviews`).map(
      (rev) => ({
        user: rev.user?.login,
        state: rev.state,
        submittedAt: rev.submitted_at,
      })
    );
    const issueComments = ghJson(
      `api repos/${o}/${r}/issues/${pr.number}/comments`
    );
    commentUsers = issueComments.map((c) => c.user?.login).filter(Boolean);
  } catch (e) {
    console.error("detail fail", full, pr.number, e.message);
  }

  const teamReviewRequested = requestedTeams.includes(TEAM_SLUG);

  const hasHumanReview = reviews.some(
    (rev) =>
      rev.user &&
      rev.user !== authorLogin &&
      rev.state !== "PENDING" &&
      !isBot(rev.user)
  );
  const hasComment = commentUsers.some(
    (u) => u && u !== authorLogin && !isBot(u)
  );

  let status;
  if (merged) status = "merged";
  else if (closed) status = "closed";
  else if (isDraft) status = "draft";
  else if (hasHumanReview || hasComment) status = "in_review";
  else status = "ready_for_review";

  const reviewerSet = new Set();
  for (const rev of reviews) if (rev.user) reviewerSet.add(rev.user);
  for (const u of commentUsers) if (u) reviewerSet.add(u);
  for (const rr of requestedReviewers) {
    reviewerSet.add(rr.replace(/^team:/, ""));
  }
  reviewerSet.delete(authorLogin);
  for (const bot of [...reviewerSet]) {
    if (isBot(bot)) reviewerSet.delete(bot);
  }

  detailed.push({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    author: authorLogin,
    // Always full owner/repo — board is org-wide.
    repository: full,
    isDraft,
    status,
    assignees,
    requestedReviewers,
    requestedTeams,
    teamReviewRequested,
    reviewers: [...reviewerSet],
  });
}

detailed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

const openStatuses = new Set(["draft", "ready_for_review", "in_review"]);
const openDetailed = detailed.filter((p) => openStatuses.has(p.status));
const repos = [
  ...new Set(openDetailed.map((p) => p.repository).filter(Boolean)),
].sort();

const payload = {
  fetchedAt: new Date().toISOString(),
  org: ORG,
  scope: `all repositories under github.com/${ORG}`,
  team: TEAM_SLUG,
  teamReviewRequestQuery: `team-review-requested:${ORG}/${TEAM_SLUG}`,
  members,
  extraAuthors,
  repositories: repos,
  prs: detailed,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2));

const byStatus = detailed.reduce((acc, p) => {
  acc[p.status] = (acc[p.status] || 0) + 1;
  return acc;
}, {});
const teamRequestedOpen = detailed.filter(
  (p) => p.teamReviewRequested && p.status !== "merged" && p.status !== "closed"
);
const byRepo = openDetailed.reduce((acc, p) => {
  acc[p.repository] = (acc[p.repository] || 0) + 1;
  return acc;
}, {});
console.log(
  JSON.stringify(
    {
      out: outPath,
      org: ORG,
      count: detailed.length,
      openCount: openDetailed.length,
      repositoryCount: repos.length,
      repositories: repos,
      byRepo,
      byStatus,
      teamReviewRequestedOpen: teamRequestedOpen.map((p) => ({
        number: p.number,
        repository: p.repository,
        author: p.author,
        status: p.status,
        title: p.title,
      })),
    },
    null,
    2
  )
);
