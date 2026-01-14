import { Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { PiCaretDownLight, PiCircleFill } from "react-icons/pi";
import { useContext, useEffect, useRef } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenu,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import {
  DashboardSeriesDisplayContext,
  SERIES_KEY_DELIMITER,
} from "@/enterprise/components/Dashboards/DashboardSeriesDisplayProvider";

export default function EditGlobalColorDropdown() {
  const { settings, updateSeriesColor, getActiveSeriesKeys } = useContext(
    DashboardSeriesDisplayContext,
  );
  const pendingColorsRef = useRef<Map<string, string>>(new Map());
  const lastSyncedSettingsRef = useRef<Record<string, Record<string, string>>>(
    {},
  );

  const activeKeys = getActiveSeriesKeys();

  // Sync pending colors when settings change from outside
  useEffect(() => {
    const currentKeys = new Set<string>();

    Object.entries(settings).forEach(([columnName, dimensionSettings]) => {
      Object.entries(dimensionSettings).forEach(
        ([dimensionValue, seriesSettings]) => {
          const key = `${columnName}${SERIES_KEY_DELIMITER}${dimensionValue}`;
          currentKeys.add(key);

          const currentColor = seriesSettings.color;
          const lastSyncedColor =
            lastSyncedSettingsRef.current[columnName]?.[dimensionValue];
          const pendingColor = pendingColorsRef.current.get(key);

          if (!pendingColorsRef.current.has(key)) {
            // Initialize if key doesn't exist
            pendingColorsRef.current.set(key, currentColor);
          } else if (
            lastSyncedColor !== undefined &&
            pendingColor === lastSyncedColor
          ) {
            // Ref value matches last synced value, so no user changes pending
            // Safe to sync external changes
            pendingColorsRef.current.set(key, currentColor);
          } else if (pendingColor === currentColor) {
            // Pending color matches current settings - user's change was already committed
            // Update ref to match (no-op but keeps ref in sync)
            pendingColorsRef.current.set(key, currentColor);
          }
          // If pendingColor !== lastSyncedColor && pendingColor !== currentColor,
          // user has pending changes, keep ref value
        },
      );
    });

    // Clean up keys that no longer exist in settings
    const keysToRemove: string[] = [];
    pendingColorsRef.current.forEach((_, key) => {
      if (!currentKeys.has(key)) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((key) => {
      pendingColorsRef.current.delete(key);
    });

    // Update lastSyncedSettingsRef to current settings after syncing
    const newLastSynced: Record<string, Record<string, string>> = {};
    Object.entries(settings).forEach(([columnName, dimensionSettings]) => {
      newLastSynced[columnName] = {};
      Object.entries(dimensionSettings).forEach(
        ([dimensionValue, seriesSettings]) => {
          newLastSynced[columnName][dimensionValue] = seriesSettings.color;
        },
      );
    });
    lastSyncedSettingsRef.current = newLastSynced;
  }, [settings]);

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
        Customize chart colors for this dashboard
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

                    const key = `${columnName}${SERIES_KEY_DELIMITER}${dimensionValue}`;
                    // Only initialize if key doesn't exist - full sync happens in useEffect
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
                                      updateSeriesColor(
                                        columnName,
                                        dimensionValue,
                                        color,
                                      );
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
