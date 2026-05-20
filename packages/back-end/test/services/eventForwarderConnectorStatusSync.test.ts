import {
  buildEventForwarderStatusResponse,
  mapLicenseConnectorPhaseToEventForwarderStatus,
} from "back-end/src/services/eventForwarderConnectorStatusSync";

describe("mapLicenseConnectorPhaseToEventForwarderStatus", () => {
  it("maps provisioning to pending", () => {
    expect(mapLicenseConnectorPhaseToEventForwarderStatus("provisioning")).toBe(
      "pending",
    );
  });

  it("maps ready to ready", () => {
    expect(mapLicenseConnectorPhaseToEventForwarderStatus("ready")).toBe(
      "ready",
    );
  });

  it("maps error to error", () => {
    expect(mapLicenseConnectorPhaseToEventForwarderStatus("error")).toBe(
      "error",
    );
  });
});

describe("buildEventForwarderStatusResponse", () => {
  it("includes message, confluent state, and task errors from license server", () => {
    const response = buildEventForwarderStatusResponse({
      confluentState: "FAILED",
      phase: "error",
      message: "Task failed",
      taskErrors: [
        {
          id: 0,
          state: "USER_ACTIONABLE_ERROR",
          trace: "snowflake.url.name: Cannot connect",
        },
      ],
    });
    expect(response.status).toBe("error");
    expect(response.phase).toBe("error");
    expect(response.message).toBe("Task failed");
    expect(response.confluentState).toBe("FAILED");
    expect(response.taskErrors).toHaveLength(1);
  });
});
