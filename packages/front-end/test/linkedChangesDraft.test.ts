import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import {
  addRedirect,
  editRedirect,
  EMPTY_LINKED_CHANGES as EMPTY,
  hasSetAsideVisualChanges,
  LinkedChangesDraft,
  linkedChangesBody,
  pruneLinkedChanges,
  RedirectFields,
  removeRedirect,
  removeVisual,
  shownUrlRedirects,
  shownVisualChangesets,
  stageVisualChange,
  stageVisualTargeting,
  undoRedirect,
} from "@/components/Experiment/TabbedPage/linkedChangesDraft";

const LOADED = "2026-01-02T00:00:00.000Z";
const redirect = (id: string): URLRedirectInterface => ({
  id,
  organization: "org",
  experiment: "exp",
  dateCreated: new Date(LOADED),
  dateUpdated: new Date(LOADED),
  urlPattern: `https://shop.example.com/${id}`,
  destinationURLs: [
    { variation: "v0", url: "" },
    { variation: "v1", url: "https://shop.example.com/b" },
  ],
  persistQueryString: true,
});
const stored = redirect("url_1");
const onStored = { key: stored.id, stored };
const fields = (over: Partial<RedirectFields> = {}): RedirectFields => ({
  urlPattern: stored.urlPattern,
  destinationURLs: stored.destinationURLs,
  persistQueryString: true,
  checkCircularDependencies: true,
  ...over,
});

// Stored before css and js were always written: c0 has no js.
const c0 = {
  id: "c0",
  description: "",
  css: "",
  variation: "v0",
  domMutations: [],
};
const c1 = {
  id: "c1",
  description: "",
  css: ".b{}",
  js: "run()",
  variation: "v1",
  domMutations: [
    { selector: "h1", action: "set" as const, attribute: "html", value: "Hi" },
  ],
};
const vc: VisualChangesetInterface = {
  id: "vc_1",
  organization: "org",
  experiment: "exp",
  editorUrl: "https://shop.example.com/",
  urlPatterns: [
    { include: true, type: "simple", pattern: "https://shop.example.com/" },
  ],
  visualChanges: [c0, c1],
};
const variationIds = ["v0", "v1"];

describe("linkedChangesDraft", () => {
  it.each<[string, (draft: LinkedChangesDraft) => LinkedChangesDraft]>([
    [
      // A missing destination reads the same as an empty one.
      "a URL Redirect",
      (d) =>
        editRedirect(
          editRedirect(d, onStored, fields({ persistQueryString: false })),
          onStored,
          fields({ destinationURLs: [stored.destinationURLs[1]] }),
        ),
    ],
    [
      "a visual change",
      (d) =>
        stageVisualChange(stageVisualChange(d, vc, { ...c1, js: "" }), vc, c1),
    ],
    [
      "the Visual Editor targeting",
      (d) =>
        stageVisualTargeting(
          stageVisualTargeting(d, vc, { ...vc, editorUrl: "https://b.com" }),
          vc,
          vc,
        ),
    ],
  ])("stages nothing once %s is edited back", (_, edit) => {
    expect(edit(EMPTY)).toEqual(EMPTY);
  });

  it("changes a staged redirect in place, and removing it leaves nothing", () => {
    let draft = addRedirect(EMPTY, "new-1", fields());
    const [added] = shownUrlRedirects(draft, []);
    draft = editRedirect(draft, added, fields({ urlPattern: "https://b.com" }));
    expect(draft.addedRedirects).toEqual([
      { ...fields({ urlPattern: "https://b.com" }), key: "new-1" },
    ]);
    expect(removeRedirect(draft, added)).toEqual(EMPTY);
  });

  it("removing a redirect drops its edit, and Undo takes both back", () => {
    const removed = removeRedirect(
      editRedirect(EMPTY, onStored, fields({ persistQueryString: false })),
      onStored,
    );
    expect(linkedChangesBody(removed, variationIds)).toEqual({
      removeUrlRedirects: ["url_1"],
    });
    expect(undoRedirect(removed, stored.id)).toEqual(EMPTY);
  });

  it("keeps the base each edit was first staged against", () => {
    // A refetch between the two edits moved what's stored.
    const moved = { ...stored, dateUpdated: new Date("2026-02-01") };
    const redirects = editRedirect(
      editRedirect(EMPTY, onStored, fields({ persistQueryString: false })),
      { key: stored.id, stored: moved },
      fields({ urlPattern: "https://b.com" }),
    );
    expect(redirects.editedRedirects[stored.id].dateUpdated).toBe(LOADED);

    const movedVc = { ...vc, visualChanges: [{ ...c0, css: "moved" }, c1] };
    const visual = stageVisualChange(
      stageVisualChange(EMPTY, vc, { ...c0, css: ".a{}" }),
      movedVc,
      { ...c0, css: ".a{color:red}" },
    );
    expect(visual.editedVisual[vc.id].changes.c0.base.css).toBe("");
  });

  it("sends only what's touched, each beside its base, with js always a string", () => {
    const draft = stageVisualTargeting(
      stageVisualChange(EMPTY, vc, { ...c0, css: ".a{}" }),
      vc,
      { ...vc, editorUrl: "https://shop.example.com/b" },
    );
    expect(linkedChangesBody(draft, variationIds)).toEqual({
      editVisualChangesets: [
        {
          id: "vc_1",
          changes: {
            editorUrl: "https://shop.example.com/b",
            visualChanges: [
              { id: "c0", css: ".a{}", js: "", domMutations: [] },
            ],
          },
          base: {
            editorUrl: "https://shop.example.com/",
            visualChanges: [{ id: "c0", css: "", js: "", domMutations: [] }],
          },
        },
      ],
    });
  });

  it("gives each redirect one destination per variation the save leaves", () => {
    // The save removes v0 and adds v2.
    const body = linkedChangesBody(
      editRedirect(
        addRedirect(EMPTY, "new-1", fields()),
        onStored,
        fields({ persistQueryString: false }),
      ),
      ["v1", "v2"],
    );
    const expected = [
      { variation: "v1", url: "https://shop.example.com/b" },
      { variation: "v2", url: "" },
    ];
    expect(body.addUrlRedirects?.[0].destinationURLs).toEqual(expected);
    expect(body.editUrlRedirects?.[0]).toMatchObject({
      id: "url_1",
      dateUpdated: LOADED,
      destinationURLs: expected,
    });
  });

  it("sets aside what's staged against something no longer there", () => {
    let draft = editRedirect(
      EMPTY,
      onStored,
      fields({ persistQueryString: false }),
    );
    draft = removeVisual(draft, "vc_gone");
    draft = stageVisualChange(draft, vc, { ...c0, css: ".a{}" });
    draft = stageVisualChange(draft, vc, { ...c1, css: "" });

    // The redirect and a changeset are gone, and the page stages v1 away.
    const pruned = pruneLinkedChanges(draft, [], [vc], ["v0"]);
    expect(pruned.editedRedirects).toEqual({});
    expect(pruned.removedVisual).toEqual([]);
    expect(Object.keys(pruned.editedVisual.vc_1.changes)).toEqual(["c0"]);
    expect(hasSetAsideVisualChanges(draft, [vc], ["v0"])).toBe(true);
    expect(hasSetAsideVisualChanges(draft, [vc], variationIds)).toBe(false);
    // Gone rather than set aside.
    const withoutC1 = { ...vc, visualChanges: [c0] };
    expect(hasSetAsideVisualChanges(draft, [withoutC1], ["v0"])).toBe(false);

    // The Visual Editor deleted c0.
    const withoutC0 = { ...vc, visualChanges: [c1] };
    expect(
      Object.keys(
        pruneLinkedChanges(draft, [stored], [withoutC0], variationIds)
          .editedVisual.vc_1.changes,
      ),
    ).toEqual(["c1"]);
  });

  it("shows what's stored with what's staged over it", () => {
    const other = redirect("url_2");
    let draft = addRedirect(EMPTY, "new-1", fields());
    draft = removeRedirect(draft, { key: other.id, stored: other });
    draft = editRedirect(
      draft,
      onStored,
      fields({ persistQueryString: false }),
    );
    expect(
      shownUrlRedirects(draft, [stored, other]).map((r) => [
        r.key,
        r.staged,
        r.persistQueryString,
      ]),
    ).toEqual([
      ["url_1", "edited", false],
      ["url_2", "removed", true],
      ["new-1", "added", true],
    ]);

    const [edited] = shownVisualChangesets(
      stageVisualChange(EMPTY, vc, { ...c0, css: ".a{}" }),
      [vc],
    );
    expect(edited.staged).toBe("edited");
    expect(edited.changeset.visualChanges.map((c) => c.css)).toEqual([
      ".a{}",
      ".b{}",
    ]);
    expect(edited.stored).toBe(vc);
    expect(
      shownVisualChangesets(removeVisual(EMPTY, vc.id), [vc])[0].staged,
    ).toBe("removed");
  });
});
