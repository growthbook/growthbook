import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import { RadixTheme } from "@/services/RadixTheme";

// Helper to create a paste event with clipboard data
const createPasteEvent = (text: string) => {
  const clipboardData = {
    getData: () => text,
  };
  return { clipboardData } as unknown as React.ClipboardEvent<HTMLInputElement>;
};

// Helper to render components with required providers
const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <RadixTheme>
      <TooltipProvider>{component}</TooltipProvider>
    </RadixTheme>,
  );
};

describe("MultiSelectField paste handling", () => {
  const flatOptions = [
    { label: "Option 1", value: "opt1" },
    { label: "Option 2", value: "opt2" },
    { label: "Option 3", value: "opt3" },
  ];

  const groupedOptions = [
    {
      label: "Group A",
      options: [
        { label: "A1", value: "a1" },
        { label: "A2", value: "a2" },
      ],
    },
    {
      label: "Group B",
      options: [
        { label: "B1", value: "b1" },
        { label: "B2", value: "b2" },
      ],
    },
  ];

  it("should parse valid JSON array", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["opt1","opt2"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });

  it("should parse JSON array without opening bracket", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('"opt1","opt2"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });

  it("should parse JSON array without closing bracket", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["opt1","opt2"');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });

  it("should parse JSON array without any brackets", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('"opt1","opt2"');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });

  it("should parse comma-separated values", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("opt1, opt2, opt3");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2", "opt3"]);
    });
  });

  it("should parse tab-separated values", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("opt1\topt2\topt3");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2", "opt3"]);
    });
  });

  it("should parse newline-separated values", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("opt1\nopt2\nopt3");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2", "opt3"]);
    });
  });

  it("should filter out values not in options (flat)", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["opt1","invalid","opt2"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });

  it("should filter out values not in options (grouped)", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={groupedOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["a1","invalid","b2","notreal"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["a1", "b2"]);
    });
  });

  it("should accept all values in grouped options", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={groupedOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["a1","a2","b1","b2"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["a1", "a2", "b1", "b2"]);
    });
  });

  it("should remove duplicates", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={["opt1"]}
        options={flatOptions}
        onChange={onChange}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["opt1","opt2","opt1"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });

  it("should allow any values when creatable=true", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        creatable={true}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["opt1","custom1","custom2"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "custom1", "custom2"]);
    });
  });

  it("should respect pattern validation", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiSelectField
        value={[]}
        options={flatOptions}
        onChange={onChange}
        creatable={true}
        pattern="^opt[0-9]+$"
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent('["opt1","invalid","opt2"]');
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"]);
    });
  });
});

describe("StringArrayField paste handling", () => {
  it("should parse comma-separated values", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField value={[]} onChange={onChange} label="Test" />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo, bar, baz");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "bar", "baz"]);
    });
  });

  it("should parse tab-separated values", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField value={[]} onChange={onChange} label="Test" />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo\tbar\tbaz");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "bar", "baz"]);
    });
  });

  it("should parse newline-separated values", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField value={[]} onChange={onChange} label="Test" />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo\nbar\nbaz");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "bar", "baz"]);
    });
  });

  it("should parse mixed delimiters", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField value={[]} onChange={onChange} label="Test" />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo,bar\tbaz\nqux");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "bar", "baz", "qux"]);
    });
  });

  it("should remove duplicates when removeDuplicates=true", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField
        value={["foo"]}
        onChange={onChange}
        removeDuplicates={true}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo, bar, foo, baz");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "bar", "baz"]);
    });
  });

  it("should keep duplicates when removeDuplicates=false", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField
        value={[]}
        onChange={onChange}
        removeDuplicates={false}
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo, bar, foo");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "bar", "foo"]);
    });
  });

  it("should respect pattern validation", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField
        value={[]}
        onChange={onChange}
        pattern="^[a-z]+$"
        label="Test"
      />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("foo, Bar123, baz");
    fireEvent.paste(input, pasteEvent);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["foo", "baz"]);
    });
  });

  it("should not trigger paste handler for single value without delimiters", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StringArrayField value={[]} onChange={onChange} label="Test" />,
    );

    const input = screen.getByRole("combobox");
    const pasteEvent = createPasteEvent("singlevalue");
    fireEvent.paste(input, pasteEvent);

    expect(onChange).not.toHaveBeenCalled();
  });
});
