import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import {
  acknowledgeSlackChannelSave,
  getSlackChannelFormValues,
  SlackChannelFormValues,
} from "@/components/SlackIntegrations/slackChannelForm";

const initial: SlackChannelFormValues = {
  ...getSlackChannelFormValues(null),
  events: ["feature.*", "experiment.decision.ship"],
};

function useChannelForm() {
  const form = useForm<SlackChannelFormValues>({ defaultValues: initial });
  return { ...form, isDirty: form.formState.isDirty };
}

describe("Slack channel saved baseline", () => {
  it("marks the submitted values clean without rewriting event selections", () => {
    const { result } = renderHook(useChannelForm);
    act(() => result.current.setValue("enabled", false, { shouldDirty: true }));
    const submitted = structuredClone(result.current.getValues());
    act(() => acknowledgeSlackChannelSave(result.current, submitted));
    expect(result.current.isDirty).toBe(false);
    expect(result.current.getValues("events")).toEqual([
      "feature.*",
      "experiment.decision.ship",
    ]);
    expect(result.current.getValues()).not.toHaveProperty(
      "excludeBookkeepingUpdates",
    );
  });

  it("retains edits made during a save and compares them with the submitted snapshot", () => {
    const { result } = renderHook(useChannelForm);
    act(() => result.current.setValue("enabled", false, { shouldDirty: true }));
    const submitted = structuredClone(result.current.getValues());
    act(() => {
      result.current.setValue("enabled", true, { shouldDirty: true });
      result.current.setValue(
        "notificationSettings",
        { type: "text" },
        { shouldDirty: true },
      );
      result.current.setValue("projects", ["project-after-submit"], {
        shouldDirty: true,
      });
      acknowledgeSlackChannelSave(result.current, submitted);
    });
    expect(result.current.getValues()).toMatchObject({
      enabled: true,
      projects: ["project-after-submit"],
      notificationSettings: { type: "text" },
    });
    expect(result.current.isDirty).toBe(true);
    expect(result.current.formState.dirtyFields).toMatchObject({
      enabled: true,
      projects: [true],
    });
    act(() => result.current.reset());
    expect(result.current.getValues()).toEqual(submitted);
    expect(result.current.isDirty).toBe(false);
  });

  it("marks a later edit clean when it is changed back to the saved snapshot", () => {
    const { result } = renderHook(useChannelForm);
    act(() =>
      result.current.setValue("tags", ["saved-tag"], { shouldDirty: true }),
    );
    const submitted = structuredClone(result.current.getValues());
    act(() => {
      result.current.setValue("tags", ["later-tag"], { shouldDirty: true });
      acknowledgeSlackChannelSave(result.current, submitted);
    });
    expect(result.current.isDirty).toBe(true);
    act(() =>
      result.current.setValue("tags", ["saved-tag"], { shouldDirty: true }),
    );
    expect(result.current.isDirty).toBe(false);
  });
});
