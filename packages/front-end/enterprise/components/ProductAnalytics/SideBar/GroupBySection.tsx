import Button from "@/ui/Button";
import { Flex, Text } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import { useExplorerContext } from "../ExplorerContext";
import { useMemo } from "react";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";

export default function GroupBySection() {
    const { draftExploreState, setDraftExploreState, commonColumns } = useExplorerContext();

    const availableColumns = useMemo(() => {
        // Filter out columns already used in dimensions
        const usedColumns = new Set(draftExploreState.dimensions.map(d => 'column' in d ? d.column : null).filter(Boolean));
        return commonColumns.filter(c => !usedColumns.has(c.column));
    }, [commonColumns, draftExploreState.dimensions]);

    const handleAddDimension = (column: string) => {
        setDraftExploreState(prev => ({
            ...prev,
            dimensions: [
                ...prev.dimensions,
                {
                    dimensionType: "dynamic",
                    column: column,
                    maxValues: 20
                }
            ]
        }));
    };

    const handleRemoveDimension = (index: number) => {
        setDraftExploreState(prev => ({
            ...prev,
            dimensions: prev.dimensions.filter((_, i) => i !== index)
        }));
    };

    return (
        <Flex direction="column" gap="2" p="3" style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
        }}>
            <Flex justify="between" align="center">
                <Text size="2" weight="medium">
                    Group by
                </Text>
                <DropdownMenu
                    trigger={
                        <Button size="xs" variant="ghost" onClick={async (e) => e?.preventDefault()}>
                            <Flex align="center" gap="2">
                                <PiPlus size={14} />
                            </Flex>
                        </Button>
                    }
                >
                    {availableColumns.length > 0 ? (
                        availableColumns.map(col => (
                            <DropdownMenuItem key={col.column} onClick={() => handleAddDimension(col.column)}>
                                {col.name || col.column}
                            </DropdownMenuItem>
                        ))
                    ) : (
                        <DropdownMenuItem disabled>No common columns found</DropdownMenuItem>
                    )}
                </DropdownMenu>
            </Flex>
            {/* Display existing dimensions */}
            {draftExploreState.dimensions.map((dim, i) => {
                if (dim.dimensionType === 'date') return null; // Skip date dimension as it's usually handled separately or fixed
                return (
                    <Flex key={i} align="center" gap="2" px="2" py="1" style={{
                        backgroundColor: "var(--surface-2)",
                        borderRadius: "var(--radius-2)",
                        fontSize: "var(--font-size-1)"
                    }}>
                        <Text>{'column' in dim ? dim.column : 'Unknown'}</Text>
                        <Button size="xs" variant="ghost" onClick={() => handleRemoveDimension(i)}><PiX size={14} /></Button>
                    </Flex>
                )
            })}
        </Flex>
    );
}
