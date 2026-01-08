import { Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { PiCaretDownLight, PiCircleFill } from "react-icons/pi";
import { useContext, useEffect, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenu,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import { DashboardSeriesDisplayContext } from "../DashboardSeriesDisplayProvider";

export default function EditGlobalColorDropdown() {
  const { settings, updateSeriesColor, getActiveSeriesKeys } = useContext(
    DashboardSeriesDisplayContext,
  );
  const [activeKeys, setActiveKeys] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  const pendingColorsRef = useRef<Map<string, string>>(new Map());

  // Sync pending colors when settings change from outside
  useEffect(() => {
    Object.entries(settings).forEach(([columnName, dimensionSettings]) => {
      Object.entries(dimensionSettings).forEach(
        ([dimensionValue, seriesSettings]) => {
          const key = `${columnName}:${dimensionValue}`;
          if (!pendingColorsRef.current.has(key)) {
            pendingColorsRef.current.set(key, seriesSettings.color);
          }
        },
      );
    });
  }, [settings]);

  // Update activeKeys after render when charts have populated activeSeriesKeys
  useEffect(() => {
    setActiveKeys(getActiveSeriesKeys());
  }, [getActiveSeriesKeys]);

  if (activeKeys.size === 0) {
    return null;
  }

  return (
    <DropdownMenu
      trigger={
        <Button variant="ghost">
          Edit Colors <PiCaretDownLight size={16} />
        </Button>
      }
    >
      <Text
        className="text-wrap"
        style={{ maxWidth: "250px", padding: "6px 12px" }}
        color="gray"
      >
        Customize chart colors for this dashboard~
      </Text>
      <Separator size="4" my="2" />
      <Flex direction="column">
        {Array.from(activeKeys.entries())
          .filter(([, dimensionValues]) => {
            // Only show columns that have active series
            return dimensionValues.size > 0;
          })
          .map(([columnName, dimensionValues]) => {
            return (
              <DropdownMenuGroup key={columnName}>
                <DropdownMenuLabel>
                  <Text weight="bold" size="2">
                    {columnName.toUpperCase()}
                  </Text>
                </DropdownMenuLabel>
                {Array.from(dimensionValues)
                  .map((dimensionValue) => {
                    const seriesSettings =
                      settings[columnName]?.[dimensionValue];
                    if (!seriesSettings) return null;

                    const key = `${columnName}:${dimensionValue}`;
                    // Initialize pending color if not set
                    if (!pendingColorsRef.current.has(key)) {
                      pendingColorsRef.current.set(key, seriesSettings.color);
                    }

                    return (
                      <Tooltip
                        key={key}
                        tipPosition="left"
                        body={
                          <Flex direction="column" gap="1">
                            <Heading as="h4" size="4">
                              Customize Color
                            </Heading>
                            <Flex direction="column" gap="3">
                              <div
                                onMouseUp={() => {
                                  // Only sync to state when user releases mouse
                                  const pendingColor =
                                    pendingColorsRef.current.get(key);
                                  if (pendingColor) {
                                    updateSeriesColor(
                                      columnName,
                                      dimensionValue,
                                      pendingColor,
                                    );
                                  }
                                }}
                              >
                                <HexColorPicker
                                  color={seriesSettings.color}
                                  onChange={(color) => {
                                    // Track color during drag, but don't sync to state yet
                                    pendingColorsRef.current.set(key, color);
                                  }}
                                />
                              </div>
                              <Flex direction="column">
                                <Text as="label" size="3" weight="bold">
                                  Hex Color
                                </Text>
                                <div
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <HexColorInput
                                    color={seriesSettings.color}
                                    onChange={(color) => {
                                      // Track color, sync on blur
                                      pendingColorsRef.current.set(key, color);
                                    }}
                                    onBlur={() => {
                                      // Sync to state when user finishes typing
                                      const pendingColor =
                                        pendingColorsRef.current.get(key);
                                      if (pendingColor) {
                                        updateSeriesColor(
                                          columnName,
                                          dimensionValue,
                                          pendingColor,
                                        );
                                      }
                                    }}
                                  />
                                </div>
                              </Flex>
                            </Flex>
                          </Flex>
                        }
                      >
                        <DropdownMenuItem>
                          <Flex align="center" gap="1">
                            <PiCircleFill
                              size={20}
                              style={{ color: seriesSettings.color }}
                            />
                            <Text>{dimensionValue}</Text>
                          </Flex>
                        </DropdownMenuItem>
                      </Tooltip>
                    );
                  })
                  .filter(Boolean)}
              </DropdownMenuGroup>
            );
          })}
      </Flex>
    </DropdownMenu>
  );
}
