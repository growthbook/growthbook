import { revealTableCell } from "@/ui/Table";

const box = (left: number, width: number) =>
  ({ left, right: left + width, width }) as DOMRect;

// A 400px-wide scroll box at scrollLeft 50, over a 1000px table whose last
// column is pinned to the box's right 100px.
function setup(cellLeft: number, cellWidth: number) {
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    scrollWidth: { value: 1000 },
    clientWidth: { value: 400 },
    scrollLeft: { value: 50 },
  });
  scroller.getBoundingClientRect = () => box(0, 400);
  scroller.scrollBy = vi.fn();
  scroller.scrollTo = vi.fn();

  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.getBoundingClientRect = () => box(cellLeft, cellWidth);
  const pinned = document.createElement("td");
  pinned.style.position = "sticky";
  pinned.getBoundingClientRect = () => box(300, 100);
  row.append(cell, pinned);

  const table = document.createElement("table");
  table.append(document.createElement("tbody"));
  table.tBodies[0].append(row);
  scroller.append(table);
  document.body.append(scroller);
  return { scroller, cell, pinned };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("revealTableCell", () => {
  it("scrolls a cell out from under the pinned column and back", () => {
    const { scroller, cell } = setup(250, 100);
    const restore = revealTableCell(cell);
    expect(scroller.scrollBy).toHaveBeenCalledWith({
      left: 50,
      behavior: "smooth",
    });
    restore();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      left: 50,
      behavior: "smooth",
    });
  });

  it("hands the scroll-back to an editor opening as another closes", () => {
    const { scroller, cell } = setup(250, 100);
    const next = document.createElement("td");
    next.getBoundingClientRect = () => box(150, 100);
    cell.closest("tbody")?.append(document.createElement("tr"));
    cell.closest("tbody")?.lastElementChild?.append(next);

    const closeFirst = revealTableCell(cell);
    closeFirst();
    const closeNext = revealTableCell(next);
    vi.advanceTimersToNextFrame();
    expect(scroller.scrollTo).not.toHaveBeenCalled();

    closeNext();
    vi.advanceTimersToNextFrame();
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      left: 50,
      behavior: "smooth",
    });
  });

  it("brings a cell wider than the room in from its left edge", () => {
    const { scroller, cell } = setup(100, 500);
    revealTableCell(cell);
    expect(scroller.scrollBy).toHaveBeenCalledWith({
      left: 100,
      behavior: "smooth",
    });
  });

  it("leaves a cell already in view alone", () => {
    const { scroller, cell } = setup(50, 100);
    revealTableCell(cell)();
    vi.advanceTimersToNextFrame();
    expect(scroller.scrollBy).not.toHaveBeenCalled();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("never scrolls for the pinned cell or a viewport cell", () => {
    const { scroller, cell, pinned } = setup(-200, 1000);
    revealTableCell(pinned);
    cell.setAttribute("data-viewport-cell", "");
    revealTableCell(cell);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });
});
