import {
  FieldValues,
  SubmitErrorHandler,
  SubmitHandler,
  UseFormReturn,
} from "react-hook-form";
import { StopSubmit } from "./StopSubmit";

/**
 * A modal's submit from a react-hook-form form. A field that fails its rules
 * keeps the modal open with its error showing; `form.handleSubmit` alone
 * resolves quietly, so the modal would close and drop the edit.
 */
export function validatedSubmit<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, "handleSubmit">,
  onValid: SubmitHandler<T>,
  onInvalid?: SubmitErrorHandler<T>,
): () => Promise<void> {
  return async () => {
    let invalid = false;
    await form.handleSubmit(onValid, async (errors, e) => {
      invalid = true;
      await onInvalid?.(errors, e);
    })();
    if (invalid) throw new StopSubmit();
  };
}
