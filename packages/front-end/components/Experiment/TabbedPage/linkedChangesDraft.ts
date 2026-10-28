import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import type { ExperimentChangesBody } from "shared/validators";
import { syncedDestinationURLs } from "shared/experiments";
import { sortObjectKeys } from "shared/util";
import {
  DestinationURL,
  URLRedirectInterface,
} from "shared/types/url-redirect";
import {
  VisualChange,
  VisualChangesetInterface,
} from "shared/types/visual-changeset";

/** A URL Redirect as the modal edits it and the save sends it. */
export type RedirectFields = NonNullable<
  ExperimentChangesBody["addUrlRedirects"]
>[number];

type VisualChangesetEdit = NonNullable<
  ExperimentChangesBody["editVisualChangesets"]
>[number];

/** The parts of a visual change the page edits. */
type StagedVisualChange = NonNullable<
  VisualChangesetEdit["changes"]["visualChanges"]
>[number];

export type VisualTargeting = Pick<
  VisualChangesetInterface,
  "editorUrl" | "urlPatterns"
>;

type VisualEdit = {
  targeting?: { value: VisualTargeting; base: VisualTargeting };
  // By visual change id, each with the variation it serves.
  changes: Record<
    string,
    { variation: string; value: StagedVisualChange; base: StagedVisualChange }
  >;
};

// Each edit keeps what it was staged against, so a refetch can't re-base it.
export type LinkedChangesDraft = {
  // Keyed on the page until the save gives them an id.
  addedRedirects: (RedirectFields & { key: string })[];
  editedRedirects: Record<string, RedirectFields & { dateUpdated: string }>;
  removedRedirects: string[];
  editedVisual: Record<string, VisualEdit>;
  removedVisual: string[];
};

export const EMPTY_LINKED_CHANGES: LinkedChangesDraft = {
  addedRedirects: [],
  editedRedirects: {},
  removedRedirects: [],
  editedVisual: {},
  removedVisual: [],
};

export function newRedirectKey(draft: LinkedChangesDraft): string {
  const taken = new Set(draft.addedRedirects.map((r) => r.key));
  let n = draft.addedRedirects.length + 1;
  while (taken.has(`new-redirect-${n}`)) n++;
  return `new-redirect-${n}`;
}

type StagedMark = "added" | "edited" | null;

export type ShownRedirect = RedirectFields & {
  key: string;
  // Null for one added on the page.
  stored: URLRedirectInterface | null;
  staged: StagedMark;
};

export type ShownVisualChangeset = {
  changeset: VisualChangesetInterface;
  stored: VisualChangesetInterface;
  staged: Exclude<StagedMark, "added">;
};

const fieldsOf = (r: RedirectFields): RedirectFields => ({
  urlPattern: r.urlPattern,
  destinationURLs: r.destinationURLs,
  persistQueryString: r.persistQueryString,
  checkCircularDependencies: r.checkCircularDependencies,
});

// A missing destination and an empty one both leave the variation where it is.
const destinations = (urls: DestinationURL[]) =>
  Object.fromEntries(
    urls.filter((d) => d.url).map((d) => [d.variation, d.url]),
  );

/** Where each variation is sent; "" leaves it on the page it matched. */
export const redirectServedValues = (
  r: Pick<RedirectFields, "destinationURLs">,
  variationIds: string[],
): Record<string, string> => {
  const urls = destinations(r.destinationURLs);
  return Object.fromEntries(variationIds.map((id) => [id, urls[id] ?? ""]));
};

/** What each variation changes on the page; "" changes nothing. */
export const visualServedValues = (
  changeset: Pick<VisualChangesetInterface, "visualChanges">,
  variationIds: string[],
): Record<string, string> =>
  Object.fromEntries(
    variationIds.map((id) => {
      const change = changeset.visualChanges.find((c) => c.variation === id);
      if (!change) return [id, ""];
      const { css, js, domMutations } = editablePartsOf(change);
      const parts = { css: css.trim(), js: js.trim(), domMutations };
      return [
        id,
        parts.css || parts.js || domMutations.length
          ? JSON.stringify(sortObjectKeys(parts))
          : "",
      ];
    }),
  );

type RedirectContent = Pick<
  RedirectFields,
  "urlPattern" | "destinationURLs" | "persistQueryString"
>;

const sameRedirect = (a: RedirectContent, b: RedirectContent) =>
  a.urlPattern === b.urlPattern &&
  a.persistQueryString === b.persistQueryString &&
  isEqual(destinations(a.destinationURLs), destinations(b.destinationURLs));

export function addRedirect(
  draft: LinkedChangesDraft,
  key: string,
  fields: RedirectFields,
): LinkedChangesDraft {
  return {
    ...draft,
    addedRedirects: [...draft.addedRedirects, { ...fieldsOf(fields), key }],
  };
}

/** An edit back to what's stored drops out; one to a staged add changes it. */
export function editRedirect(
  draft: LinkedChangesDraft,
  target: Pick<ShownRedirect, "key" | "stored">,
  fields: RedirectFields,
): LinkedChangesDraft {
  const { stored } = target;
  if (!stored) {
    return {
      ...draft,
      addedRedirects: draft.addedRedirects.map((a) =>
        a.key === target.key ? { ...fieldsOf(fields), key: a.key } : a,
      ),
    };
  }
  const staged = draft.editedRedirects[stored.id];
  return {
    ...draft,
    editedRedirects: sameRedirect(fields, stored)
      ? omit(draft.editedRedirects, stored.id)
      : {
          ...draft.editedRedirects,
          [stored.id]: {
            ...fieldsOf(fields),
            dateUpdated:
              staged?.dateUpdated ?? new Date(stored.dateUpdated).toISOString(),
          },
        },
  };
}

/** Takes back whatever is staged for this redirect. */
export function undoRedirect(
  draft: LinkedChangesDraft,
  key: string,
): LinkedChangesDraft {
  return {
    ...draft,
    addedRedirects: draft.addedRedirects.filter((a) => a.key !== key),
    editedRedirects: omit(draft.editedRedirects, key),
    removedRedirects: draft.removedRedirects.filter((id) => id !== key),
  };
}

/** A staged add just goes; a stored one drops its edit too. */
export function removeRedirect(
  draft: LinkedChangesDraft,
  target: Pick<ShownRedirect, "key" | "stored">,
): LinkedChangesDraft {
  const next = undoRedirect(draft, target.key);
  if (!target.stored) return next;
  return { ...next, removedRedirects: [...next.removedRedirects, target.key] };
}

const targetingOf = ({
  editorUrl,
  urlPatterns,
}: VisualTargeting): VisualTargeting => ({ editorUrl, urlPatterns });

// As the page reads a stored change: an absent css or js is empty.
const editablePartsOf = (
  c: Pick<VisualChange, "id" | "css" | "js" | "domMutations">,
): StagedVisualChange => ({
  id: c.id,
  css: c.css ?? "",
  js: c.js ?? "",
  domMutations: c.domMutations ?? [],
});

function withVisualEdit(
  draft: LinkedChangesDraft,
  id: string,
  edit: VisualEdit,
): LinkedChangesDraft {
  return {
    ...draft,
    editedVisual:
      edit.targeting || Object.keys(edit.changes).length
        ? { ...draft.editedVisual, [id]: edit }
        : omit(draft.editedVisual, id),
  };
}

/** Stages a changeset's target URL and patterns; the first base staged is kept. */
export function stageVisualTargeting(
  draft: LinkedChangesDraft,
  stored: VisualChangesetInterface,
  targeting: VisualTargeting,
): LinkedChangesDraft {
  const edit = draft.editedVisual[stored.id];
  const base = edit?.targeting?.base ?? targetingOf(stored);
  const value = targetingOf(targeting);
  return withVisualEdit(draft, stored.id, {
    changes: edit?.changes ?? {},
    ...(!isEqual(value, base) && { targeting: { value, base } }),
  });
}

/** Stages one variation's visual change; the first base staged is kept. */
export function stageVisualChange(
  draft: LinkedChangesDraft,
  stored: VisualChangesetInterface,
  change: Pick<VisualChange, "id" | "css" | "js" | "domMutations">,
): LinkedChangesDraft {
  const storedChange = stored.visualChanges.find((c) => c.id === change.id);
  if (!storedChange) return draft;
  const edit = draft.editedVisual[stored.id];
  const changes = edit?.changes ?? {};
  const base = changes[change.id]?.base ?? editablePartsOf(storedChange);
  const value = editablePartsOf(change);
  return withVisualEdit(draft, stored.id, {
    ...edit,
    changes: isEqual(value, base)
      ? omit(changes, change.id)
      : {
          ...changes,
          [change.id]: { variation: storedChange.variation, value, base },
        },
  });
}

export function removeVisual(
  draft: LinkedChangesDraft,
  id: string,
): LinkedChangesDraft {
  const next = undoVisual(draft, id);
  return { ...next, removedVisual: [...next.removedVisual, id] };
}

export function undoVisual(
  draft: LinkedChangesDraft,
  id: string,
): LinkedChangesDraft {
  return {
    ...draft,
    editedVisual: omit(draft.editedVisual, id),
    removedVisual: draft.removedVisual.filter((v) => v !== id),
  };
}

/** Stages every edit again over what's stored now, so saving overwrites it. */
export function rebaseLinkedChanges(
  draft: LinkedChangesDraft,
  redirects: URLRedirectInterface[],
  changesets: VisualChangesetInterface[],
): LinkedChangesDraft {
  let next: LinkedChangesDraft = {
    ...draft,
    editedRedirects: {},
    editedVisual: {},
  };
  for (const [id, fields] of Object.entries(draft.editedRedirects)) {
    const stored = redirects.find((r) => r.id === id);
    if (stored) next = editRedirect(next, { key: id, stored }, fields);
  }
  for (const [id, { targeting, changes }] of Object.entries(
    draft.editedVisual,
  )) {
    const stored = changesets.find((c) => c.id === id);
    if (!stored) continue;
    if (targeting) next = stageVisualTargeting(next, stored, targeting.value);
    for (const { value } of Object.values(changes)) {
      next = stageVisualChange(next, stored, value);
    }
  }
  return next;
}

// Drops what no longer exists. A visual change for a variation staged away
// sits out until that variation is back.
export function pruneLinkedChanges(
  draft: LinkedChangesDraft,
  redirects: URLRedirectInterface[],
  changesets: VisualChangesetInterface[],
  variationIds: string[],
): LinkedChangesDraft {
  const redirectIds = new Set(redirects.map((r) => r.id));
  const byId = new Map(changesets.map((c) => [c.id, c]));
  const shown = new Set(variationIds);
  const editedVisual: Record<string, VisualEdit> = {};
  for (const [id, edit] of Object.entries(draft.editedVisual)) {
    const changeIds = new Set(byId.get(id)?.visualChanges.map((c) => c.id));
    const changes = Object.fromEntries(
      Object.entries(edit.changes).filter(
        ([changeId, c]) => changeIds.has(changeId) && shown.has(c.variation),
      ),
    );
    if (byId.has(id) && (edit.targeting || Object.keys(changes).length)) {
      editedVisual[id] = { ...edit, changes };
    }
  }
  return {
    addedRedirects: draft.addedRedirects,
    editedRedirects: Object.fromEntries(
      Object.entries(draft.editedRedirects).filter(([id]) =>
        redirectIds.has(id),
      ),
    ),
    removedRedirects: draft.removedRedirects.filter((id) =>
      redirectIds.has(id),
    ),
    editedVisual,
    removedVisual: draft.removedVisual.filter((id) => byId.has(id)),
  };
}

/** Whether a visual change that still exists sits out for a variation staged away. */
export function hasSetAsideVisualChanges(
  draft: LinkedChangesDraft,
  changesets: VisualChangesetInterface[],
  variationIds: string[],
): boolean {
  const shown = new Set(variationIds);
  return changesets.some((vc) => {
    const staged = draft.editedVisual[vc.id]?.changes ?? {};
    return vc.visualChanges.some((c) => {
      const variation = staged[c.id]?.variation;
      return !!variation && !shown.has(variation);
    });
  });
}

/**
 * The stored redirects with what's staged over them, then the staged adds. One
 * staged for removal is already gone.
 */
export function shownUrlRedirects(
  draft: LinkedChangesDraft,
  stored: URLRedirectInterface[],
): ShownRedirect[] {
  return [
    ...stored
      .filter((r) => !draft.removedRedirects.includes(r.id))
      .map((r): ShownRedirect => {
        const edit = draft.editedRedirects[r.id];
        return {
          ...(edit
            ? fieldsOf(edit)
            : fieldsOf({ ...r, checkCircularDependencies: true })),
          key: r.id,
          stored: r,
          staged: edit ? "edited" : null,
        };
      }),
    ...draft.addedRedirects.map(
      (a): ShownRedirect => ({
        ...fieldsOf(a),
        key: a.key,
        stored: null,
        staged: "added",
      }),
    ),
  ];
}

export function shownVisualChangesets(
  draft: LinkedChangesDraft,
  stored: VisualChangesetInterface[],
): ShownVisualChangeset[] {
  return stored
    .filter((vc) => !draft.removedVisual.includes(vc.id))
    .map((vc) => {
      const edit = draft.editedVisual[vc.id];
      return {
        changeset: edit
          ? {
              ...vc,
              ...edit.targeting?.value,
              visualChanges: vc.visualChanges.map((c) => ({
                ...c,
                ...edit.changes[c.id]?.value,
              })),
            }
          : vc,
        stored: vc,
        staged: edit ? "edited" : null,
      };
    });
}

// Each redirect gets one destination per variation the save leaves, as the
// server's variation sync would give it.
export function linkedChangesBody(
  draft: LinkedChangesDraft,
  variationIds: string[],
): ExperimentChangesBody {
  const variations = variationIds.map((id) => ({ id }));
  const projected = (r: RedirectFields): RedirectFields => ({
    ...fieldsOf(r),
    destinationURLs: syncedDestinationURLs(r.destinationURLs, variations),
  });
  const visualEdits = Object.entries(draft.editedVisual).flatMap(
    ([id, { targeting, changes: staged }]): VisualChangesetEdit[] => {
      const changes: VisualChangesetEdit["changes"] = {};
      const base: VisualChangesetEdit["base"] = {};
      if (targeting && targeting.value.editorUrl !== targeting.base.editorUrl) {
        changes.editorUrl = targeting.value.editorUrl;
        base.editorUrl = targeting.base.editorUrl;
      }
      if (
        targeting &&
        !isEqual(targeting.value.urlPatterns, targeting.base.urlPatterns)
      ) {
        changes.urlPatterns = targeting.value.urlPatterns;
        base.urlPatterns = targeting.base.urlPatterns;
      }
      const edited = Object.values(staged);
      if (edited.length) {
        changes.visualChanges = edited.map((c) => c.value);
        base.visualChanges = edited.map((c) => c.base);
      }
      return Object.keys(changes).length ? [{ id, changes, base }] : [];
    },
  );
  const editedRedirects = Object.entries(draft.editedRedirects);
  return {
    ...(draft.addedRedirects.length > 0 && {
      addUrlRedirects: draft.addedRedirects.map(projected),
    }),
    ...(editedRedirects.length > 0 && {
      editUrlRedirects: editedRedirects.map(([id, r]) => ({
        ...projected(r),
        id,
        dateUpdated: r.dateUpdated,
      })),
    }),
    ...(draft.removedRedirects.length > 0 && {
      removeUrlRedirects: draft.removedRedirects,
    }),
    ...(visualEdits.length > 0 && { editVisualChangesets: visualEdits }),
    ...(draft.removedVisual.length > 0 && {
      removeVisualChangesets: draft.removedVisual,
    }),
  };
}
