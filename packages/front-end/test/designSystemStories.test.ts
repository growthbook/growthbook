import fs from "fs";
import path from "path";
import {
  findDanglingReferences,
  slugify,
  StoryMeta,
  storyCategories,
  storyMetaSchema,
} from "@/ui/storyMeta";

// Same glob the /design-system page uses, so whatever the page renders is
// what this test checks.
const modules = import.meta.glob<Record<string, unknown>>(
  "/ui/**/*.stories.tsx",
  { eager: true },
);
const files = Object.keys(modules);

describe("design system stories", () => {
  it("finds the stories files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s exports a default component and a valid meta", (file) => {
    const mod = modules[file];
    expect(typeof mod.default).toBe("function");
    const parsed = storyMetaSchema.safeParse(mod.meta);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  const metas = files.flatMap((f) => {
    const parsed = storyMetaSchema.safeParse(modules[f].meta);
    return parsed.success ? [{ file: f, meta: parsed.data as StoryMeta }] : [];
  });

  it("gives every story a unique name and anchor", () => {
    const slugs = [
      ...storyCategories.map((c) => c.id),
      ...metas.map(({ meta }) => slugify(meta.name)),
    ];
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
    expect(dupes).toEqual([]);
  });

  it("names the component after its file", () => {
    const mismatched = metas
      .filter(({ meta }) => meta.category !== "patterns")
      .filter(({ file, meta }) => {
        const base = path.basename(file, ".stories.tsx");
        return !meta.name.startsWith(base);
      })
      .map(({ file, meta }) => `${file}: ${meta.name}`);
    expect(mismatched).toEqual([]);
  });

  it("points examples at files that exist", () => {
    const missing = metas.flatMap(({ meta }) =>
      (meta.examples ?? []).filter(
        (e) => !fs.existsSync(path.resolve(__dirname, "..", e)),
      ),
    );
    expect(missing).toEqual([]);
  });

  it("only cross-references stories that exist", () => {
    expect(findDanglingReferences(metas.map((m) => m.meta))).toEqual([]);
  });
});
