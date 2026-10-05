import { useRef } from "react";
import { render } from "@testing-library/react";
import VirtualizedDiff from "@/components/AuditHistoryExplorer/VirtualizedDiff";
import VirtualizedCode from "@/components/SyntaxHighlighting/VirtualizedCode";

const lines = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join("\n");

// The scroll box and the virtualized view mount in the same commit, so the
// box's ref is attached only after the view's first layout pass
function DiffInBox() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ maxHeight: 200, overflowY: "auto" }}>
      <VirtualizedDiff
        oldValue={lines(300, "old")}
        newValue={lines(300, "new")}
        scrollRef={ref}
      />
    </div>
  );
}

function CodeInBox() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ maxHeight: 200, overflowY: "auto" }}>
      <VirtualizedCode
        code={lines(300, "line")}
        language="json"
        scrollRef={ref}
      />
    </div>
  );
}

describe("virtualized views mounted with their scroll box", () => {
  // jsdom has no layout; give elements a size the virtualizer can measure
  const sizes = { offsetHeight: 200, offsetWidth: 600 };
  const original = Object.fromEntries(
    Object.keys(sizes).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]),
  );
  beforeAll(() => {
    for (const [key, value] of Object.entries(sizes)) {
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get: () => value,
      });
    }
  });
  afterAll(() => {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor)
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
    }
  });

  it("draws diff rows", () => {
    const { container } = render(<DiffInBox />);
    expect(
      container.querySelectorAll("[data-diff-row]").length,
    ).toBeGreaterThan(0);
  });

  it("draws code lines", () => {
    const { container } = render(<CodeInBox />);
    expect(container.querySelectorAll("[data-index]").length).toBeGreaterThan(
      0,
    );
  });
});
