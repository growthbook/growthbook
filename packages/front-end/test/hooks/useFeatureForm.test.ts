import { renderHook } from "@testing-library/react";
import { FeatureEnvironment } from "shared/types/feature";
import { CustomField } from "shared/types/custom-fields";
import { useFeatureForm } from "@/hooks/useFeatureForm";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { useWatching } from "@/services/WatchProvider";
import { useCustomFields } from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";

vi.mock("@/services/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/services/DefinitionsContext", () => ({
  useDefinitions: vi.fn(),
}));

vi.mock("@/services/features", () => ({
  useEnvironments: vi.fn(),
}));

vi.mock("@/services/WatchProvider", () => ({
  useWatching: vi.fn(),
}));

vi.mock("@/hooks/useCustomFields", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useCustomFields")
  >("@/hooks/useCustomFields");
  return {
    ...actual,
    useCustomFields: vi.fn(),
  };
});

vi.mock("@/hooks/usePermissionsUtils", () => ({
  default: vi.fn(),
}));

vi.mock("@/services/UserContext", () => ({
  useUser: vi.fn(),
}));

type TestValues = {
  project?: string;
  customFields: Record<string, string>;
  environmentSettings: Record<string, FeatureEnvironment>;
};

const makeField = (overrides: Partial<CustomField>): CustomField => ({
  id: "cf_default",
  name: "Default Field",
  type: "text",
  required: false,
  section: "feature",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  ...overrides,
});

describe("useFeatureForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDefinitions).mockReturnValue({
      project: "proj_a",
      refreshTags: vi.fn(),
    } as unknown as ReturnType<typeof useDefinitions>);
    vi.mocked(useAuth).mockReturnValue({
      apiCall: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useWatching).mockReturnValue({
      refreshWatching: vi.fn(),
    } as unknown as ReturnType<typeof useWatching>);
    vi.mocked(useUser).mockReturnValue({
      hasCommercialFeature: vi.fn((feature: string) => {
        return feature === "custom-metadata";
      }),
    } as unknown as ReturnType<typeof useUser>);
    vi.mocked(useEnvironments).mockReturnValue([
      { id: "dev", defaultState: true },
      { id: "prod", defaultState: true },
    ] as ReturnType<typeof useEnvironments>);
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canPublishFeature: vi.fn(({ project }: { project?: string }, [envId]) => {
        if (project === "proj_a") return envId === "dev";
        if (project === "proj_b") return envId === "prod";
        return false;
      }),
      canManageFeatureDrafts: vi.fn(() => true),
    } as unknown as ReturnType<typeof usePermissionsUtil>);
    vi.mocked(useCustomFields).mockReturnValue([]);
  });

  it("computes environment settings for a specific project", () => {
    const { result } = renderHook(() =>
      useFeatureForm<TestValues>({
        initialValues: {},
      }),
    );

    expect(result.current.form.getValues("project")).toBe("proj_a");
    expect(result.current.form.getValues("environmentSettings")).toEqual({
      dev: { enabled: true, rules: [] },
      prod: { enabled: false, rules: [] },
    });

    expect(result.current.getEnvironmentSettingsForProject("proj_b")).toEqual({
      dev: { enabled: false, rules: [] },
      prod: { enabled: true, rules: [] },
    });
  });

  it("treats an explicitly provided undefined project as all projects", () => {
    const { result } = renderHook(() =>
      useFeatureForm<TestValues>({
        initialValues: {
          project: undefined,
        },
      }),
    );

    expect(result.current.form.getValues("project")).toBe("");
    expect(result.current.form.getValues("environmentSettings")).toEqual({
      dev: { enabled: false, rules: [] },
      prod: { enabled: false, rules: [] },
    });
  });

  it("treats initialValues as mount-only defaults", () => {
    const { result, rerender } = renderHook(
      ({ project }: { project?: string }) =>
        useFeatureForm<TestValues>({
          initialValues: { project },
        }),
      {
        initialProps: {
          project: "proj_a",
        },
      },
    );

    expect(result.current.form.getValues("project")).toBe("proj_a");
    expect(result.current.form.getValues("environmentSettings")).toEqual({
      dev: { enabled: true, rules: [] },
      prod: { enabled: false, rules: [] },
    });

    rerender({ project: "proj_b" });

    expect(result.current.form.getValues("project")).toBe("proj_a");
    expect(result.current.form.getValues("environmentSettings")).toEqual({
      dev: { enabled: true, rules: [] },
      prod: { enabled: false, rules: [] },
    });
  });

  it("normalizes custom field default values into form-safe strings", () => {
    vi.mocked(useCustomFields).mockReturnValue([
      makeField({ id: "flag", type: "boolean", defaultValue: true }),
      makeField({
        id: "segments",
        type: "multiselect",
        defaultValue: ["beta", "staff"],
      }),
      makeField({ id: "label", type: "text", defaultValue: "hello" }),
    ]);

    const { result } = renderHook(() =>
      useFeatureForm<TestValues>({
        initialValues: {
          project: "",
        },
      }),
    );

    expect(result.current.form.getValues("customFields")).toEqual({
      flag: "true",
      segments: JSON.stringify(["beta", "staff"]),
      label: "hello",
    });
  });
});
