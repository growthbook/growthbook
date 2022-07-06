import { ApiCallType } from "./auth";
import { getApiHost } from "./env";

export async function uploadFile(
  apiCall: ApiCallType<{
    uploadURL: string;
    fileURL: string;
    uploadMethod: string;
  }>,
  file: File
) {
  const ext = file.name.split(".").reverse()[0];
  const { uploadURL, fileURL, uploadMethod } = await apiCall(
    `/file/upload/${ext}`,
    {
      method: "POST",
    }
  );

  const res = await fetch(
    uploadURL.match(/^\//) ? getApiHost() + uploadURL : uploadURL,
    {
      method: "GET",
      headers: {
        "Content-Type": file.type,
      },
      ...(uploadMethod !== "google-cloud" && { body: file }),
    }
  );

  if (!res.ok) {
    throw new Error("Failed to upload file");
  }

  return {
    fileURL: fileURL.match(/^\//) ? getApiHost() + fileURL : fileURL,
  };
}
