import React from "react";
import { UseFormReturn } from "react-hook-form";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ScheduleInputs({ form }: { form: UseFormReturn<any> }) {
  return (
    <div className="pb-2">
      <label>Scheduling Conditions (optional)</label>
      <div className="pb-2">
        <span className="pr-2">Start Date</span>
        <input
          type="datetime-local"
          value={form.watch("validAfter") || ""}
          onChange={(e) => form.setValue("validAfter", e.target.value)}
        />
        {form.watch("validAfter") && (
          <button
            className="btn btn-link text-danger"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              form.setValue("validAfter", null);
            }}
          >
            {" "}
            remove
          </button>
        )}
      </div>
      <div className="pb-2">
        <span className="pr-2">End Date</span>
        <input
          type="datetime-local"
          value={form.watch("validBefore") || ""}
          onChange={(e) => form.setValue("validBefore", e.target.value)}
        />
        {form.watch("validBefore") && (
          <button
            className="btn btn-link text-danger"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              form.setValue("validBefore", null);
            }}
          >
            remove
          </button>
        )}
      </div>
    </div>
  );
}
