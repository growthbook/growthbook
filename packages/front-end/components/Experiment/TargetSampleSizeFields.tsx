import { useEffect, useRef, useState, type Ref } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import Field from "@/components/Forms/Field";

type FormWithTargetSampleSize = {
  targetSampleSize?: number;
};

/** Parsed committed value for the form; accepts digit-only strings (including leading zeros). */
function parseOptionalPositiveInt(raw: string): number | undefined {
  if (raw === "" || raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

function formatCommittedValue(v: number | undefined): string {
  return v != null && Number.isFinite(v) ? String(Math.round(v)) : "";
}

/**
 * Text input so users can clear the field and edit freely (number inputs coerce
 * invalid intermediates like a leading 0 after deleting the first digit).
 */
function TargetSampleSizeInput({
  value,
  onChange,
  onBlur,
  name,
  disabled,
  inputRef,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  onBlur: () => void;
  name: string;
  disabled?: boolean;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState(() => formatCommittedValue(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(formatCommittedValue(value));
    }
  }, [value]);

  return (
    <Field
      aria-label="Target sample size"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      name={name}
      placeholder="No limit"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
        setDraft(formatCommittedValue(value));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d+$/.test(raw)) {
          return;
        }
        setDraft(raw);
        onChange(parseOptionalPositiveInt(raw));
      }}
      onBlur={() => {
        focusedRef.current = false;
        const next = parseOptionalPositiveInt(draft);
        onChange(next);
        setDraft(formatCommittedValue(next));
        onBlur();
      }}
      ref={inputRef}
    />
  );
}

export function TargetSampleSizeFields({
  form: formProp,
  disabled,
}: {
  form: unknown;
  disabled?: boolean;
}) {
  const form = formProp as UseFormReturn<FormWithTargetSampleSize>;

  return (
    <div className="form-group mt-3">
      <div className="font-weight-bold mb-2">Target sample size (optional)</div>
      <Controller
        name="targetSampleSize"
        control={form.control}
        rules={{
          validate: (v) => {
            if (v === undefined || v === null) return true;
            return (Number.isInteger(v) && v >= 1) || "Must be at least 1";
          },
        }}
        render={({ field }) => (
          <div className="row">
            <div className="col-4">
              <TargetSampleSizeInput
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                disabled={disabled}
                inputRef={field.ref}
              />
            </div>
          </div>
        )}
      />
      <small className="form-text text-muted d-block">
        Stopping criteria for the experiment based upon sample size. When total
        users reaches this number, the experiment status will be marked stopped
        and the Experiment Decision Framework will render a recommendation.
      </small>
    </div>
  );
}
