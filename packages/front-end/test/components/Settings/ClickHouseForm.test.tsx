import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ClickHouseForm from "@/components/Settings/ClickHouseForm";

describe("ClickHouse materialized CTE option", () => {
  it("defaults to disabled and saves boolean values when toggled", () => {
    const setParams = vi.fn();
    const onParamChange = vi.fn();
    const { rerender } = render(
      <ClickHouseForm
        params={{}}
        existing={false}
        setParams={setParams}
        onParamChange={onParamChange}
      />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: /^Use materialized CTEs \(experimental\)/,
    });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(checkbox);
    expect(setParams).toHaveBeenLastCalledWith({ useMaterializedCTEs: true });

    rerender(
      <ClickHouseForm
        params={{ useMaterializedCTEs: true }}
        existing={true}
        setParams={setParams}
        onParamChange={onParamChange}
      />,
    );
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(checkbox);
    expect(setParams).toHaveBeenLastCalledWith({ useMaterializedCTEs: false });
    expect(screen.getByText(/enable_materialized_cte enabled/)).toBeDefined();
  });
});
