import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  KeyboardEvent,
} from "react";
import { Box, Text } from "@radix-ui/themes";
import * as Popover from "@radix-ui/react-popover";
import { PiX } from "react-icons/pi";
import { RadixColor } from "@/ui/HelperText";
import { RadixTheme } from "@/services/RadixTheme";
import clsx from "clsx";

export interface MultiSelectSearchOption {
  value: string; // Internal value (e.g., "tag:Purchases")
  label: string; // Display text (e.g., "Purchases")
  group: string; // Group name (e.g., "Tags", "Metric Groups")
  color?: RadixColor; // Optional badge color
}

export interface MultiSelectSearchProps {
  options: MultiSelectSearchOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  groupLabels?: Record<string, string>;
  className?: string;
}

export default function MultiSelectSearch({
  options,
  selectedValues,
  onChange,
  placeholder = "Search...",
  groupLabels,
  className,
}: MultiSelectSearchProps) {
  const [searchValue, setSearchValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const editableRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightedValueRef = useRef<string | null>(null);

  // Get selected options
  const selectedOptions = useMemo(() => {
    return options.filter((opt) => selectedValues.includes(opt.value));
  }, [options, selectedValues]);

  // Filter options based on search and exclude already selected
  const filteredOptions = useMemo(() => {
    const searchLower = searchValue.toLowerCase();
    const filtered = options.filter(
      (opt) =>
        !selectedValues.includes(opt.value) &&
        opt.label.toLowerCase().includes(searchLower),
    );

    // Group by group name
    const grouped: Record<string, MultiSelectSearchOption[]> = {};
    filtered.forEach((opt) => {
      if (!grouped[opt.group]) {
        grouped[opt.group] = [];
      }
      grouped[opt.group].push(opt);
    });

    return grouped;
  }, [options, searchValue, selectedValues]);

  // Flatten filtered options for keyboard navigation
  const flatFilteredOptions = useMemo(() => {
    const flat: MultiSelectSearchOption[] = [];
    Object.values(filteredOptions).forEach((groupOptions) => {
      flat.push(...groupOptions);
    });
    return flat;
  }, [filteredOptions]);

  // Parse filter string to extract values
  const parseFilterString = (str: string): string[] => {
    // Split by commas and filter out empty strings
    const parts = str.trim().split(/,/).map(p => p.trim()).filter(Boolean);
    const values: string[] = [];
    
    parts.forEach((part) => {
      // Check if it matches field:value format
      if (part.includes(":")) {
        values.push(part);
      } else {
        // Try to match against available options
        const matchingOption = options.find(
          (opt) => opt.label.toLowerCase() === part.toLowerCase()
        );
        if (matchingOption) {
          values.push(matchingOption.value);
        }
      }
    });
    
    return values;
  };

  // Handle option selection
  const handleSelect = (option: MultiSelectSearchOption) => {
    onChange([...selectedValues, option.value]);
    setSearchValue("");
    setHighlightedIndex(-1);
    highlightedValueRef.current = null;
  };

  // Handle badge removal
  const handleRemove = (value: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(selectedValues.filter((v) => v !== value));
    editableRef.current?.focus();
  };

  // Handle input in contentEditable
  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    
    // Extract text content, ignoring the filter spans
    let text = "";
    target.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      }
    });
    
    setSearchValue(text.trim());
    setIsOpen(text.trim().length > 0 || selectedValues.length === 0);
  };

  // Handle paste in contentEditable
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text");
    const parsed = parseFilterString(pastedText);
    
    if (parsed.length > 0) {
      onChange(parsed);
      setSearchValue("");
      
      // Clear any text in the editable div
      if (editableRef.current) {
        const textNodes: Node[] = [];
        editableRef.current.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            textNodes.push(node);
          }
        });
        textNodes.forEach((node) => node.remove());
      }
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Check if all content is selected
    const selection = window.getSelection();
    const isAllSelected = selection && 
      selection.rangeCount > 0 && 
      editableRef.current &&
      selection.toString().length > 0 &&
      selection.getRangeAt(0).toString().length === editableRef.current.textContent?.length;

    // Handle Backspace when all content is selected
    if (e.key === "Backspace" && isAllSelected) {
      e.preventDefault();
      onChange([]);
      setSearchValue("");
      if (editableRef.current) {
        editableRef.current.textContent = "";
      }
      return;
    }

    // Handle Backspace when at the start and no search value
    if (e.key === "Backspace" && searchValue === "" && selectedValues.length > 0) {
      const sel = window.getSelection();
      const range = sel?.getRangeAt(0);
      
      // Check if cursor is at the very beginning
      if (range && range.startOffset === 0 && editableRef.current) {
        const firstChild = editableRef.current.firstChild;
        if (!firstChild || range.startContainer === editableRef.current) {
          e.preventDefault();
          // Remove last selected value
          onChange(selectedValues.slice(0, -1));
          return;
        }
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const newIndex = prev < flatFilteredOptions.length - 1 ? prev + 1 : prev;
        highlightedValueRef.current = flatFilteredOptions[newIndex]?.value || null;
        return newIndex;
      });
      setIsOpen(true);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const newIndex = prev > 0 ? prev - 1 : 0;
        highlightedValueRef.current = flatFilteredOptions[newIndex]?.value || null;
        return newIndex;
      });
      setIsOpen(true);
      return;
    }

    if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      const option = flatFilteredOptions[highlightedIndex];
      if (option) {
        handleSelect(option);
      }
      return;
    }

    if (e.key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
      highlightedValueRef.current = null;
      editableRef.current?.blur();
      return;
    }

    // Open dropdown when typing
    if (e.key.length === 1 || e.key === "Backspace") {
      setIsOpen(true);
    }
  };

  // Handle input focus
  const handleFocus = () => {
    setIsOpen(true);
    // Select first option if available
    if (flatFilteredOptions.length > 0 && highlightedIndex === -1) {
      setHighlightedIndex(0);
    }
  };

  // Handle click on container
  const handleContainerClick = () => {
    setIsOpen(true);
    editableRef.current?.focus();
    // Select first option if available
    if (flatFilteredOptions.length > 0 && highlightedIndex === -1) {
      setHighlightedIndex(0);
    }
  };

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        highlightedValueRef.current = null;
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Update highlighted index when filtered options change
  useEffect(() => {
    if (flatFilteredOptions.length === 0) {
      setHighlightedIndex(-1);
      highlightedValueRef.current = null;
      return;
    }

    // If nothing is currently highlighted, select the first option
    if (highlightedIndex === -1 || !highlightedValueRef.current) {
      setHighlightedIndex(0);
      highlightedValueRef.current = flatFilteredOptions[0]?.value || null;
      return;
    }

    // Check if the previously highlighted option is still in the filtered list
    const newIndex = flatFilteredOptions.findIndex(
      (opt) => opt.value === highlightedValueRef.current
    );

    if (newIndex !== -1) {
      // The option is still in the list, update to its new index
      setHighlightedIndex(newIndex);
    } else {
      // The option was filtered out, select the first option
      setHighlightedIndex(0);
      highlightedValueRef.current = flatFilteredOptions[0]?.value || null;
    }
  }, [flatFilteredOptions, highlightedIndex]);

  // Update contentEditable when selectedValues change
  useEffect(() => {
    if (!editableRef.current) return;

    // Store current cursor position
    const selection = window.getSelection();
    let cursorOffset = 0;
    let shouldMoveCursorToEnd = false;
    
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      cursorOffset = range.startOffset;
    }
    
    // Check if we're adding a new filter (no search value means we just selected something)
    if (searchValue === "" && selectedOptions.length > 0) {
      shouldMoveCursorToEnd = true;
    }

    // Clear the div and rebuild
    const textContent = searchValue;
    editableRef.current.innerHTML = "";
    
    // Add filter spans
    selectedOptions.forEach((option, idx) => {
      if (!editableRef.current) return;
      
      // Create filter badge span
      const span = document.createElement("span");
      span.setAttribute("data-filter-value", option.value);
      span.contentEditable = "false";
      span.style.display = "inline-flex";
      span.style.alignItems = "center";
      span.style.gap = "4px";
      span.style.padding = "2px 8px";
      span.style.borderRadius = "4px";
      span.style.backgroundColor = option.color 
        ? `var(--${option.color}-3)` 
        : "var(--gray-3)";
      span.style.color = option.color 
        ? `var(--${option.color}-11)` 
        : "var(--gray-11)";
      span.style.fontSize = "14px";
      span.style.fontWeight = "500";
      span.style.marginRight = "4px";
      span.style.userSelect = "text";
      span.style.cursor = "default";
      
      const labelSpan = document.createElement("span");
      labelSpan.textContent = option.label;
      span.appendChild(labelSpan);
      
      const closeIcon = document.createElement("span");
      closeIcon.innerHTML = "×";
      closeIcon.style.cursor = "pointer";
      closeIcon.style.flexShrink = "0";
      closeIcon.style.marginLeft = "4px";
      closeIcon.onclick = (e) => {
        e.stopPropagation();
        onChange(selectedValues.filter((v) => v !== option.value));
        editableRef.current?.focus();
      };
      span.appendChild(closeIcon);
      
      editableRef.current.appendChild(span);
      
      // Add comma separator after each filter except the last one
      if (idx < selectedOptions.length - 1) {
        const commaSpan = document.createElement("span");
        commaSpan.contentEditable = "false";
        commaSpan.style.marginRight = "4px";
        commaSpan.textContent = ",";
        editableRef.current.appendChild(commaSpan);
      }
    });
    
    // Add search text if any
    if (textContent) {
      const textNode = document.createTextNode(textContent);
      editableRef.current.appendChild(textNode);
      
      // Restore cursor position
      try {
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(textNode, Math.min(cursorOffset, textContent.length));
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch (e) {
        // Ignore errors in cursor positioning
      }
    } else if (shouldMoveCursorToEnd) {
      // Move cursor to the end after adding a filter
      try {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(editableRef.current);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
        editableRef.current.focus();
      } catch (e) {
        // Ignore errors in cursor positioning
      }
    }
  }, [selectedValues, searchValue, selectedOptions, onChange]);

  return (
    <div ref={containerRef} className={clsx("multi-select-search", className)}>
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <Box
            style={{
              position: "relative",
              border: "1px solid var(--gray-6)",
              borderRadius: "var(--radius-2)",
              minHeight: "36px",
              display: "flex",
              alignItems: "center",
              padding: "4px 8px",
              backgroundColor: "var(--color-background)",
              cursor: "text",
              transition: "border-color 0.15s",
            }}
            onClick={handleContainerClick}
          >
            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={handleFocus}
              data-placeholder={selectedOptions.length === 0 ? placeholder : ""}
              className="multi-select-editable"
              style={{
                flex: 1,
                minWidth: "120px",
                outline: "none",
                fontSize: "14px",
                lineHeight: "1.5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                position: "relative",
              }}
            />
          </Box>
        </Popover.Trigger>
        
        <Popover.Portal>
          <RadixTheme>
            <Popover.Content
              side="bottom"
              align="start"
              style={{
                width: "var(--radix-popover-trigger-width)",
                maxHeight: "300px",
                overflowY: "auto",
                padding: "8px",
                borderRadius: "4px",
                backgroundColor: "var(--color-background)",
                boxShadow: "hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px",
                zIndex: 1000,
              }}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onEscapeKeyDown={() => setIsOpen(false)}
              onInteractOutside={(e) => {
                // Don't close if clicking inside the container
                if (containerRef.current?.contains(e.target as Node)) {
                  e.preventDefault();
                }
              }}
            >
              {Object.keys(filteredOptions).length > 0 ? (
                Object.entries(filteredOptions).map(([groupName, groupOptions]) => (
                  <Box key={groupName} style={{ marginBottom: "8px" }}>
                    <Text
                      size="1"
                      weight="medium"
                      color="gray"
                      style={{
                        padding: "4px 8px",
                        display: "block",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      {groupLabels?.[groupName] || groupName}
                    </Text>
                    {groupOptions.map((option) => {
                      const flatIndex = flatFilteredOptions.indexOf(option);
                      const isHighlighted = flatIndex === highlightedIndex;
                      return (
                      <Box
                        key={option.value}
                        onClick={() => handleSelect(option)}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "4px",
                          cursor: "pointer",
                          backgroundColor: isHighlighted
                            ? "var(--gray-3)"
                            : "transparent",
                        }}
                        onMouseEnter={() => {
                          setHighlightedIndex(flatIndex);
                          highlightedValueRef.current = option.value;
                        }}
                      >
                        <Text size="2">{option.label}</Text>
                      </Box>
                      );
                    })}
                  </Box>
                ))
              ) : (
                <Box style={{ padding: "8px" }}>
                  <Text size="2" color="gray">
                    No options available
                  </Text>
                </Box>
              )}
            </Popover.Content>
          </RadixTheme>
        </Popover.Portal>
      </Popover.Root>
      <style dangerouslySetInnerHTML={{
        __html: `
          .multi-select-editable[data-placeholder]:empty:before {
            content: attr(data-placeholder);
            color: var(--gray-9);
            pointer-events: none;
            position: absolute;
          }
        `
      }} />
    </div>
  );
}

