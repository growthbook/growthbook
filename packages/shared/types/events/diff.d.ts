interface HierarchicalValue {
  key: string;
  changes?: ItemChanges;
  added?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  modified?: Array<{
    key: string;
    oldValue?: unknown;
    newValue?: unknown;
    values?: HierarchicalValue[];
  }>;
  values?: HierarchicalValue[];
}

interface SimpleModification {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

interface HierarchicalModification {
  key: string;
  values: HierarchicalValue[];
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Array<SimpleModification | HierarchicalModification>;
}

type ModificationItem = SimpleModification | HierarchicalModification;

export interface DiffResult {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: ModificationItem[];
}

export interface ItemFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ItemChange {
  id: string;
  oldValue?: unknown;
  newValue: unknown;
  fieldChanges?: ItemFieldChange[];
  oldIndex?: number;
  newIndex?: number;
  steps?: number; // positive = moved up, negative = moved down
}

export type OrderSummary =
  | {
      type: "insertShift";
      insertIndex: number;
      direction: "down" | "up";
      affectedCount: number;
    }
  | {
      type: "reorderShift";
      movedId: string;
      fromIndex: number;
      toIndex: number;
      direction: "down" | "up";
      affectedCount: number;
    }
  | {
      type: "deleteShift";
      deleteIndex: number;
      direction: "up" | "down";
      affectedCount: number;
    };

export interface ItemChanges {
  added?: Record<string, unknown>[];
  removed?: Record<string, unknown>[];
  modified?: ItemChange[];
  orderSummaries?: OrderSummary[];
}

export interface NestedObjectConfig {
  key: string;
  idField?: string; // Optional - only needed for array items
  ignoredKeys?: string[];
  arrayField?: string; // Field name that contains array of items to diff
}

export interface ContainerChanges {
  added?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  modified?: ModificationItem[];
  items?: ItemChanges;
}
