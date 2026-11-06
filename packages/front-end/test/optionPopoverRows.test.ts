import { onFirstRow } from "@/components/Features/OptionTooltipShell";

// A wrapping list of tags, each holding a nested trigger, laid out at `tops`.
function list(tops: number[]) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  const triggers = tops.map((top) => {
    const tag = document.createElement("div");
    const label = document.createElement("span");
    const trigger = document.createElement("div");
    label.appendChild(trigger);
    tag.appendChild(label);
    tag.getBoundingClientRect = () => ({ top }) as DOMRect;
    Object.defineProperty(tag, "offsetHeight", { value: 22 });
    wrap.appendChild(tag);
    return trigger;
  });
  document.body.appendChild(wrap);
  return triggers;
}

describe("onFirstRow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds a nested trigger's tag on the list's first line", () => {
    const [first, second] = list([100, 100, 126]);
    expect(onFirstRow(first)).toBe(true);
    expect(onFirstRow(second)).toBe(true);
  });

  it("puts a wrapped tag on a later line", () => {
    const [, , third] = list([100, 100, 126]);
    expect(onFirstRow(third)).toBe(false);
  });

  it("treats a value outside any wrapping list as first", () => {
    const lone = document.createElement("div");
    document.body.appendChild(lone);
    expect(onFirstRow(lone)).toBe(true);
  });
});
