import { Request, Response } from "express";
import {
  getSignedImageToken,
  getSignedPublicImageToken,
} from "back-end/src/routers/upload/upload.controller";
import { getSignedImageUrl } from "back-end/src/services/files";
import {
  getContextFromReq,
  getOrganizationById,
} from "back-end/src/services/organizations";
import { getReportByUid } from "back-end/src/models/ReportModel";

jest.mock("back-end/src/services/files", () => ({
  uploadFile: jest.fn(),
  getSignedImageUrl: jest.fn(),
  getSignedUploadUrl: jest.fn(),
  getImageData: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(),
  getOrganizationById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentByUid: jest.fn(),
}));

jest.mock("back-end/src/models/ReportModel", () => ({
  getReportByUid: jest.fn(),
  getReportsByExperimentId: jest.fn(),
}));

jest.mock("shared/experiments", () => ({
  getAllVariations: jest.fn(() => []),
}));

jest.mock("back-end/src/util/secrets", () => ({
  UPLOAD_METHOD: "s3",
}));

const mockGetSignedImageUrl = getSignedImageUrl as jest.MockedFunction<
  typeof getSignedImageUrl
>;
const mockGetContextFromReq = getContextFromReq as jest.MockedFunction<
  typeof getContextFromReq
>;
const mockGetOrganizationById = getOrganizationById as jest.MockedFunction<
  typeof getOrganizationById
>;
const mockGetReportByUid = getReportByUid as jest.MockedFunction<
  typeof getReportByUid
>;

describe("upload signed URL cache headers", () => {
  const signedUrl = "https://signed.example.com/image.png";
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockSetHeader: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockSetHeader = jest.fn();

    jest.clearAllMocks();
    mockGetSignedImageUrl.mockResolvedValue(signedUrl);
  });

  it("sets Cache-Control: no-store for authenticated signed image URLs", async () => {
    mockGetContextFromReq.mockReturnValue({
      org: {
        id: "org_123",
        settings: {},
      },
    } as ReturnType<typeof getContextFromReq>);

    const req = {
      path: "/signed-url/org_123/2026-04/img_123.png",
    } as Request;
    const res = {
      setHeader: mockSetHeader,
      status: mockStatus,
    } as unknown as Response;

    await getSignedImageToken(req as never, res);

    expect(mockSetHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl,
      }),
    );
  });

  it("sets Cache-Control: no-store for public signed image URLs", async () => {
    mockGetOrganizationById.mockResolvedValue({
      id: "org_123",
      settings: {},
    } as Awaited<ReturnType<typeof getOrganizationById>>);
    mockGetReportByUid.mockResolvedValue({
      type: "experiment-snapshot",
      shareLevel: "public",
      organization: "org_123",
      description: "Screenshot path org_123/2026-04/img_123.png",
    } as Awaited<ReturnType<typeof getReportByUid>>);

    const req = {
      path: "/upload/public-signed-url/org_123/2026-04/img_123.png",
      query: {
        shareUid: "shr_123",
        shareType: "report",
      },
    } as Request;
    const res = {
      setHeader: mockSetHeader,
      status: mockStatus,
    } as unknown as Response;

    await getSignedPublicImageToken(req, res);

    expect(mockSetHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl,
      }),
    );
  });
});
