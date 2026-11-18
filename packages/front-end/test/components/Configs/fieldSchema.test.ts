import { pinnedCellBackground } from "@/components/Configs/fieldSchema";

describe("pinnedCellBackground", () => {
  it("lays a row's tint over the opaque panel color", () => {
    expect(pinnedCellBackground("var(--red-a3)")).toBe(
      "linear-gradient(var(--red-a3), var(--red-a3)) var(--color-panel-solid)",
    );
  });

  it("leaves an untinted row to the table's own background", () => {
    expect(pinnedCellBackground(null)).toBeUndefined();
  });
});
