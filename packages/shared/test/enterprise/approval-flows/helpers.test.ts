// import { evalCondition } from "@growthbook/growthbook";
// import {
//   getApprovalFlowKey,
//   requiresApprovalForEntity,
//   canUserReviewEntity,
//   canAdminBypassApprovalFlow,
// } from "../../../src/enterprise/approval-flows/helpers";
// import { ApprovalEntityType, ApprovalFlowInterface, ApprovalFlowStatus } from "shared/validators";

// jest.mock("@growthbook/growthbook", () => ({
//   evalCondition: jest.fn(),
// }));

// const evalConditionMock = evalCondition as jest.MockedFunction<
//   typeof evalCondition
// >;

// describe("enterprise/approval-flows helpers", () => {
//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//   describe("getApprovalFlowKey", () => {
//     it("maps entity types to approval flow keys", () => {
//       expect(getApprovalFlowKey("fact-metric")).toBe("metrics");
//       // Test with type assertion for entity types that exist in the function but not in the type
//       expect(getApprovalFlowKey("experiment" as ApprovalEntityType)).toBe("experiments");
//       expect(getApprovalFlowKey("metric" as ApprovalEntityType)).toBe("metrics");
//       expect(getApprovalFlowKey("fact-table" as ApprovalEntityType)).toBe("factTables");
//     });

//     it("returns null for unsupported entity type", () => {
//       expect(getApprovalFlowKey("unknown" as ApprovalEntityType)).toBeNull();
//     });
//   });

//   describe("requiresApprovalForEntity", () => {
//     it("returns false when no approval flow settings exist", () => {
//       const entity = { id: "entity1", managedBy: "admin" as const };
//       const approvalFlowSettings = undefined;

//       expect(
//         requiresApprovalForEntity("fact-metric", entity, approvalFlowSettings),
//       ).toBe(false);
//     });

//     it("returns false when no setting requires review", () => {
//       const entity = { id: "entity1", managedBy: "admin" as const };
//       const approvalFlowSettings = {
//         metrics: [{ requireReviewOn: false, resetReviewOnChange: false }],
//       };

//       expect(
//         requiresApprovalForEntity("fact-metric", entity, approvalFlowSettings),
//       ).toBe(false);
//     });

//     it("respects officialOnly flag", () => {
//       const entity = { id: "entity1", managedBy: "" as const };
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//             officialOnly: true,
//           },
//         ],
//       };

//       expect(
//         requiresApprovalForEntity("fact-metric", entity, approvalFlowSettings),
//       ).toBe(false);
//     });

//     it("returns true when condition is empty", () => {
//       const entity = { id: "entity1", managedBy: "admin" as const };
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//             condition: {},
//           },
//         ],
//       };

//       expect(
//         requiresApprovalForEntity("fact-metric", entity, approvalFlowSettings),
//       ).toBe(true);
//       expect(evalConditionMock).not.toHaveBeenCalled();
//     });

//     it("evaluates non-empty conditions", () => {
//       const entity = { id: "entity1", managedBy: "admin" as const };
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//             condition: { project: "p1" },
//           },
//         ],
//       };

//       evalConditionMock.mockReturnValueOnce(true);

//       expect(
//         requiresApprovalForEntity("fact-metric", entity, approvalFlowSettings),
//       ).toBe(true);
//       expect(evalConditionMock).toHaveBeenCalledWith(entity, { project: "p1" });
//     });
//   });

//   describe("canUserReviewEntity", () => {
//     const createMockApprovalFlow = (
//       status = "pending-review",
//       author = "author1",
//     ) =>
//       ({
//         id: "af1",
//         entity: {
//           entityType: "fact-metric" as const,
//           entityId: "entity1",
//           originalEntity: {},
//           proposedChanges: {},
//         },
//         title: "Test Approval Flow",
//         proposedChanges: {} as ApprovalFlowProposedChanges,
//         status: status as ApprovalFlowStatus,
//         author,
//         reviews: [] as Review[],
//         activityLog: [] as ActivityLogEntry[],
//         dateCreated: new Date() as Date,
//         dateUpdated: new Date() as Date,
//         organization: "org1" as string,
//       }) as Partial<ApprovalFlowInterface>;

//     it("returns false when settings are missing", () => {
//       const entity = { id: "entity1" };
//       const approvalFlow = createMockApprovalFlow();
//       const approvalFlowSettings = undefined;
//       const userRole = "admin";

//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity,
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(false);
//     });

//     it("returns false when user lacks required role", () => {
//       const entity = { id: "entity1" };
//       const approvalFlow = createMockApprovalFlow();
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             approverRoles: ["analyst"],
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//           },
//         ],
//       };
//       const userRole = "viewer";

//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity,
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(false);
//     });

//     it("returns false when user is the author", () => {
//       const entity = { id: "entity1" };
//       const approvalFlow = createMockApprovalFlow("pending-review", "userId1");
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             approverRoles: ["admin"],
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//           },
//         ],
//       };
//       const userRole = "admin";

//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity,
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(false);
//     });

//     it("returns false when approval flow is merged", () => {
//       const entity = { id: "entity1" };
//       const approvalFlow = createMockApprovalFlow("merged");
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             approverRoles: ["admin"],
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//           },
//         ],
//       };
//       const userRole = "admin";

//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity,
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(false);
//     });

//     it("returns true when role is allowed and no condition is set", () => {
//       const entity = { id: "entity1" };
//       const approvalFlow = createMockApprovalFlow();
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             approverRoles: ["admin"],
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//           },
//         ],
//       };
//       const userRole = "admin";

//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity,
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(true);
//       expect(evalConditionMock).not.toHaveBeenCalled();
//     });

//     it("evaluates the condition for the entity", () => {
//       const approvalFlow = createMockApprovalFlow();
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             approverRoles: ["admin"],
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//             condition: { project: "p1" },
//           },
//         ],
//       };
//       const userRole = "admin";

//       evalConditionMock.mockReturnValueOnce(false);
//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity: { project: "p2" },
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(false);

//       evalConditionMock.mockReturnValueOnce(true);
//       expect(
//         canUserReviewEntity({
//           entityType: "fact-metric",
//           approvalFlow,
//           entity: { project: "p1" },
//           approvalFlowSettings,
//           userRole,
//           userId: "userId1",
//         }),
//       ).toBe(true);
//     });
//   });

//   describe("canAdminBypassApprovalFlow", () => {
//     it("returns false when user is not a super admin", () => {
//       const entity = { id: "entity1" };
//       const approvalFlowSettings = undefined;

//       expect(
//         canAdminBypassApprovalFlow(
//           "fact-metric",
//           entity,
//           approvalFlowSettings,
//           false,
//           "admin",
//         ),
//       ).toBe(false);
//     });

//     it("returns false when no approval flow settings exist", () => {
//       const entity = { id: "entity1" };
//       const approvalFlowSettings = undefined;

//       expect(
//         canAdminBypassApprovalFlow(
//           "fact-metric",
//           entity,
//           approvalFlowSettings,
//           true,
//           "admin",
//         ),
//       ).toBe(false);
//     });

//     it("allows bypass when adminCanBypass is true without conditions", () => {
//       const entity = { id: "entity1" };
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             adminCanBypass: true,
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//           },
//         ],
//       };

//       expect(
//         canAdminBypassApprovalFlow(
//           "fact-metric",
//           entity,
//           approvalFlowSettings,
//           true,
//           "admin",
//         ),
//       ).toBe(true);
//     });

//     it("evaluates conditions when adminCanBypass is enabled", () => {
//       const entity = { id: "entity1" };
//       const approvalFlowSettings = {
//         metrics: [
//           {
//             adminCanBypass: true,
//             requireReviewOn: true,
//             resetReviewOnChange: false,
//             condition: { project: "p1" },
//           },
//         ],
//       };

//       evalConditionMock.mockReturnValueOnce(false);
//       expect(
//         canAdminBypassApprovalFlow(
//           "fact-metric",
//           entity,
//           approvalFlowSettings,
//           true,
//           "admin",
//         ),
//       ).toBe(false);

//       evalConditionMock.mockReturnValueOnce(true);
//       expect(
//         canAdminBypassApprovalFlow(
//           "fact-metric",
//           entity,
//           approvalFlowSettings,
//           true,
//           "admin",
//         ),
//       ).toBe(true);
//     });
//   });
// });
