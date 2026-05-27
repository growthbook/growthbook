import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ExperimentInterface } from "shared/validators";
import ShareModal from "@/components/Share/ShareModal";

vi.mock("next/router", () => ({
  useRouter: vi.fn(() => ({ query: { q: "" } })),
}));

vi.mock("@/services/UserContext", () => ({
  useUser: vi.fn(() => ({
    getOwnerDisplay: () => "Bar",
    hasCommercialFeature: () => true,
    settings: {},
  })),
}));

vi.mock("@/hooks/useExperiments", () => ({
  useExperiments: vi.fn(() => ({
    experiments: [
      {
        id: "exp_171wm84x7movsgrzl",
        uid: "81d028f007054667b7859168bcf4906c",
        trackingKey: "TestExperiment",
        organization: "org_171wm84x7movs5ul9",
        project: "prj_2CaodVYaxSmGzXmNJgV98Y",
        owner: "u_171wm84x7movs5ukh",
        datasource: "",
        userIdType: "anonymous",
        exposureQueryId: "",
        hashAttribute: "id",
        fallbackAttribute: "",
        hashVersion: 2,
        disableStickyBucketing: false,
        name: "TestExperiment",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        tags: [],
        description: "",
        hypothesis: "",
        pastNotifications: [],
        metricOverrides: [],
        decisionFrameworkSettings: {
          decisionFrameworkMetricOverrides: [],
        },
        goalMetrics: [],
        secondaryMetrics: [],
        guardrailMetrics: [],
        activationMetric: "",
        segment: "",
        queryFilter: "",
        skipPartialData: false,
        attributionModel: "firstExposure",
        archived: false,
        status: "running",
        analysis: "",
        releasedVariationId: "",
        excludeFromPayload: true,
        autoAssign: false,
        implementation: "code",
        previewURL: "",
        targetURLRegex: "",
        variations: [
          {
            id: "var_movsgjxz",
            name: "Control",
            description: "",
            key: "0",
            screenshots: [],
          },
          {
            id: "var_movsgjy0",
            name: "Variation 1",
            description: "",
            key: "1",
            screenshots: [],
          },
        ],
        phases: [
          {
            dateStarted: new Date(),
            name: "Main",
            reason: "",
            coverage: 1,
            condition: "{}",
            savedGroups: [],
            prerequisites: [],
            namespace: {
              enabled: false,
              name: "",
              range: [0, 1],
            },
            seed: "77c889ff-9eaf-4b78-a11f-18d87593f771",
            variationWeights: [0.5, 0.5],
            variations: [
              {
                id: "var_movsgjxz",
                status: "active",
              },
              {
                id: "var_movsgjy0",
                status: "active",
              },
            ],
            banditEvents: [],
          },
        ],
        lastSnapshotAttempt: new Date(),
        nextSnapshotAttempt: new Date(),
        autoSnapshots: true,
        ideaSource: "",
        regressionAdjustmentEnabled: false,
        linkedFeatures: [],
        sequentialTestingEnabled: false,
        sequentialTestingTuningParameter: 5000,
        type: "standard",
        banditScheduleValue: 1,
        banditScheduleUnit: "days",
        banditBurnInValue: 1,
        banditBurnInUnit: "days",
        banditConversionWindowUnit: "hours",
        shareLevel: "organization",
        analysisSummary: {
          resultsStatus: {
            variations: [],
            settings: {
              sequentialTesting: true,
            },
          },
          precomputedDimensions: [],
          snapshotId: "",
        },
        dismissedWarnings: [],
        customMetricSlices: [],
        pendingFeatureDrafts: [],
        manualLaunchChecklist: [],
      },
    ] satisfies ExperimentInterface[],
  })),
}));

const getColorPickerValue = (pickerTestId: string) => {
  const picker = screen.getByTestId(pickerTestId);

  const satBrightSlider = within(picker).getByRole("slider", { name: "Color" });
  const hueSlider = within(picker).getByRole("slider", { name: "Hue" });

  const saturationBrightnessText =
    satBrightSlider.getAttribute("aria-valuetext");

  const match = saturationBrightnessText?.match(
    /Saturation (\d+)%, Brightness (\d+)%/,
  );

  if (match) {
    const saturation = Number(match[1]);
    const brightness = Number(match[2]);

    const hue = Number(hueSlider.getAttribute("aria-valuenow"));

    return {
      h: hue,
      s: saturation,
      b: brightness,
    };
  }

  throw new Error(
    `Unable to parse color of color picker with testid ${pickerTestId}.`,
  );
};

describe("ShareModal", () => {
  it("Color pickers should be synced with text inputs", async () => {
    const Harness = () => {
      const [modalIsOpen, setModalIsOpen] = useState(true);

      return (
        <ShareModal
          title="New Presentation"
          modalState={modalIsOpen}
          setModalState={setModalIsOpen}
          refreshList={vi.fn()}
        />
      );
    };

    render(<Harness />);

    const user = userEvent.setup();

    const result = await screen.findByRole("button", { name: /Next/ });

    await user.click(result);

    await user.click(screen.getByRole("combobox"));

    await user.click(await screen.findByText("Custom"));

    const backgroundColorInput = screen.getByLabelText("Background color");

    expect(backgroundColorInput.getAttribute("value")).toBe("3400a3");

    const textColorInput = screen.getByLabelText("Text color");

    expect(textColorInput.getAttribute("value")).toBe("ffffff");

    const backgroundColorPickerTestId = "background-color-picker";
    const textColorPickerTestId = "text-color-picker";

    expect(getColorPickerValue(backgroundColorPickerTestId)).toEqual({
      h: 259,
      s: 100,
      b: 64,
    });

    expect(getColorPickerValue(textColorPickerTestId)).toEqual({
      h: 0,
      s: 0,
      b: 100,
    });

    await act(async () => {
      await user.clear(backgroundColorInput);

      await user.type(backgroundColorInput, "dd169e");
    });

    expect(getColorPickerValue(backgroundColorPickerTestId)).toEqual({
      h: 319,
      s: 90,
      b: 87,
    });

    await act(async () => {
      await user.clear(textColorInput);

      await user.type(textColorInput, "8ee4dc");
    });

    expect(getColorPickerValue(textColorPickerTestId)).toEqual({
      h: 174,
      s: 38,
      b: 89,
    });
  });
});
