import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, beforeEach, vi, expect } from "vitest";
import ConditionInput from "@/components/Features/ConditionInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";

vi.mock("@/services/DefinitionsContext", () => ({
  useDefinitions: vi.fn(),
}));

vi.mock("@/hooks/useOrgSettings");

describe("ConditionInput", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // @ts-expect-error - partial mock
    vi.mocked(useDefinitions).mockReturnValue({
      savedGroups: [],
      getSavedGroupById: vi.fn(),
    });

    vi.mocked(useOrgSettings).mockReturnValue({
      attributeSchema: [
        {
          property: "user_id",
          datatype: "string",
          archived: false,
          projects: [],
        },
        {
          property: "version",
          datatype: "string",
          format: "version",
          archived: false,
          projects: [],
        },
      ],
    });
  });

  it("properly handles operator update when attribute changes", async () => {
    // Setup
    render(
      <ConditionInput defaultValue="{}" onChange={mockOnChange} project="" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Target by Attributes")).toBeInTheDocument();
    });
    const addButton = screen.getByText("Add attribute targeting");
    fireEvent.click(addButton);
    await waitFor(() => {
      expect(screen.getByText("IF")).toBeInTheDocument();
    });

    // 0 is attribute, 1 is operator
    const comboboxes = screen.getAllByRole("combobox");

    // Not sure why click does not work, but this does
    // Select operator
    fireEvent.focus(comboboxes[1]);
    fireEvent.keyDown(comboboxes[1], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => {
      const option = screen.getByText("is greater than");
      fireEvent.click(option);
    });

    // Type value
    const valueInput = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "321" } });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ user_id: { $gt: "321" } });
      }
    });

    // Update operator
    fireEvent.focus(comboboxes[1]);
    fireEvent.keyDown(comboboxes[1], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => {
      const option = screen.getByText("is less than or equal to");
      fireEvent.click(option);
    });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ user_id: { $lte: "321" } });
      }
    });

    // Update attribute to a version string
    fireEvent.focus(comboboxes[0]);
    fireEvent.keyDown(comboboxes[0], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => {
      const option = screen.getByText("version");
      fireEvent.click(option);
    });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ version: { $vlte: "321" } });
      }
    });

    // Update attribute back to a non-version string
    fireEvent.focus(comboboxes[0]);
    fireEvent.keyDown(comboboxes[0], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => {
      const option = screen.getByText("user_id");
      fireEvent.click(option);
    });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ user_id: { $lte: "321" } });
      }
    });
  });

  it("properly handles equal operator update when attribute changes", async () => {
    // Setup
    render(
      <ConditionInput defaultValue="{}" onChange={mockOnChange} project="" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Target by Attributes")).toBeInTheDocument();
    });
    const addButton = screen.getByText("Add attribute targeting");
    fireEvent.click(addButton);
    await waitFor(() => {
      expect(screen.getByText("IF")).toBeInTheDocument();
    });

    // 0 is attribute, 1 is operator
    const comboboxes = screen.getAllByRole("combobox");

    // Not sure why click does not work, but this does
    // Select operator
    fireEvent.focus(comboboxes[1]);
    fireEvent.keyDown(comboboxes[1], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(async () => {
      const option = await screen.findByRole("option", { name: "is equal to" });
      fireEvent.click(option);
    });

    // Type value
    const valueInput = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "321" } });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ user_id: "321" });
      }
    });

    // Update attribute to a version string
    fireEvent.focus(comboboxes[0]);
    fireEvent.keyDown(comboboxes[0], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => {
      const option = screen.getByText("version");
      fireEvent.click(option);
    });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ version: { $veq: "321" } });
      }
    });

    // Update attribute back to a non-version string
    fireEvent.focus(comboboxes[0]);
    fireEvent.keyDown(comboboxes[0], { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => {
      const option = screen.getByText("user_id");
      fireEvent.click(option);
    });

    // Assert condition is correct
    await waitFor(() => {
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      if (lastCall) {
        const outputCondition = JSON.parse(lastCall[0]);
        // Ensure it uses string comparison operator
        expect(outputCondition).toEqual({ user_id: "321" });
      }
    });
  });
});
