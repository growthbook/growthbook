import { useEffect, useState, type ReactNode } from "react";
import { PiArrowsClockwise, PiLockSimpleFill } from "react-icons/pi";
import { getEqualWeights } from "shared/experiments";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { decimalToPercent, floatRound, rebalance } from "@/services/utils";
import styles from "@/components/Features/VariationsInput.module.scss";

export interface VariationSplitTableProps<TRow> {
  label?: string;
  rows: TRow[];
  getRowKey: (row: TRow) => string;
  /** Index of this row in the full weight vector (same length as `weights`). */
  getWeightIndex: (row: TRow) => number;
  /** Full variation weight vector (sum 1). */
  weights: number[];
  onApplyWeights: (next: number[]) => void;
  renderVariationCell: (row: TRow) => ReactNode;
  /** Optional column (e.g. delete checkbox). */
  suffixColumnHeader?: ReactNode;
  renderSuffixCell?: (row: TRow) => ReactNode;
  startEditingSplits?: boolean;
  /** When true, splits are read-only and the customize control is hidden. */
  disableCustomSplit?: boolean;
  /** Per-row: when false, that row stays read-only even in edit mode. */
  isRowSplitEditable?: (row: TRow) => boolean;
  /** Override default `rebalance` (e.g. only redistribute among some variations). */
  rebalanceWeights?: (
    weights: number[],
    index: number,
    newDecimal: number,
  ) => number[];
  /** Override default equal split across all weight slots. */
  onSetEqualWeights?: () => void;
  /** When set, controls visibility of "set equal" (e.g. among active variations only). */
  splitsAreEqual?: boolean;
}

function SplitPercentInput({
  weightIndex,
  weights,
  onApplyWeights,
  disabled,
  rebalanceFn,
}: {
  weightIndex: number;
  weights: number[];
  onApplyWeights: (next: number[]) => void;
  disabled: boolean;
  rebalanceFn: (
    weights: number[],
    index: number,
    newDecimal: number,
  ) => number[];
}) {
  const w = weights[weightIndex] ?? 0;
  const weightPercent = floatRound(w * 100, 2);
  const [val, setVal] = useState<number>(weightPercent);
  useEffect(() => {
    setVal(weightPercent);
  }, [weightPercent]);

  return (
    <div className={`position-relative ${styles.percentInputWrap}`}>
      <Field
        style={{ width: 95 }}
        value={val}
        onChange={(e) => {
          setVal(parseFloat(e.target.value));
        }}
        onBlur={() => {
          const decimal = (val >= 0 ? val : 0) / 100;
          const next = rebalanceFn([...weights], weightIndex, decimal);
          onApplyWeights(next);
        }}
        type="number"
        min={0}
        max={100}
        step="any"
        className={styles.percentInput}
        disabled={disabled}
      />
      <span>%</span>
    </div>
  );
}

export default function VariationSplitTable<TRow>({
  label,
  rows,
  getRowKey,
  getWeightIndex,
  weights,
  onApplyWeights,
  renderVariationCell,
  suffixColumnHeader,
  renderSuffixCell,
  startEditingSplits = false,
  disableCustomSplit = false,
  isRowSplitEditable,
  rebalanceWeights,
  onSetEqualWeights,
  splitsAreEqual: splitsAreEqualProp,
}: VariationSplitTableProps<TRow>) {
  const [editingSplits, setEditingSplits] = useState(startEditingSplits);
  const rebalanceFn = rebalanceWeights ?? rebalance;

  useEffect(() => {
    if (disableCustomSplit) {
      setEditingSplits(false);
    }
  }, [disableCustomSplit]);

  const defaultAllEqual =
    weights.length > 0 &&
    weights.every((w) => Math.abs(w - weights[0]) < 0.0001);
  const splitsAreEqual = splitsAreEqualProp ?? defaultAllEqual;

  const setEqualWeights = () => {
    if (onSetEqualWeights) {
      onSetEqualWeights();
      return;
    }
    const next = getEqualWeights(weights.length, 4);
    onApplyWeights(next);
  };

  return (
    <div className={label ? "mb-3" : undefined}>
      {label ? <label>{label}</label> : null}
      <Table size="2">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Variation</TableColumnHeader>
            <TableColumnHeader>
              Split
              {!disableCustomSplit && !editingSplits && (
                <Tooltip
                  body="Customize split"
                  usePortal={true}
                  tipPosition="top"
                >
                  <Link
                    className="ml-1 mb-0"
                    onClick={() => {
                      setEditingSplits(true);
                    }}
                  >
                    <PiLockSimpleFill className="text-purple" size={15} />
                  </Link>
                </Tooltip>
              )}
              {editingSplits && !splitsAreEqual && !disableCustomSplit && (
                <Tooltip
                  body="Assign equal weights to all variations"
                  usePortal={true}
                  tipPosition="top"
                >
                  <Link
                    className="ml-2 link-purple small"
                    onClick={(e) => {
                      e.preventDefault();
                      setEqualWeights();
                    }}
                  >
                    <PiArrowsClockwise className="mr-1" size={12} />
                    set equal
                  </Link>
                </Tooltip>
              )}
            </TableColumnHeader>
            {renderSuffixCell ? (
              <TableColumnHeader justify="center">
                {suffixColumnHeader ?? ""}
              </TableColumnHeader>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const wi = getWeightIndex(row);
            const w = weights[wi] ?? 0;
            const rowCanEdit =
              !disableCustomSplit &&
              editingSplits &&
              (isRowSplitEditable?.(row) ?? true);
            return (
              <TableRow key={getRowKey(row)}>
                <TableCell>{renderVariationCell(row)}</TableCell>
                <TableCell>
                  {rowCanEdit ? (
                    <SplitPercentInput
                      weightIndex={wi}
                      weights={weights}
                      onApplyWeights={onApplyWeights}
                      disabled={false}
                      rebalanceFn={rebalanceFn}
                    />
                  ) : (
                    <span>{decimalToPercent(w)}%</span>
                  )}
                </TableCell>
                {renderSuffixCell ? (
                  <TableCell justify="center">
                    {renderSuffixCell(row)}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
