import { SignedUploadUrlResponse, UploadResponse } from "back-end/types/upload";
import { ApiCallType } from "./auth";
import { getApiHost, getUploadMethod } from "./env";

export async function uploadFile(
  apiCall: ApiCallType<UploadResponse | SignedUploadUrlResponse>,
  file: File,
) {
  const uploadMethod = getUploadMethod();
  let fileURL = "";

  if (uploadMethod === "local") {
    // Direct upload for local storage
    try {
      ({ fileURL } = (await apiCall("/upload", {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      })) as UploadResponse);
    } catch (e) {
      throw new Error("Failed to upload file: " + e.message);
    }
  } else {
    // Signed URL approach for cloud storage (S3 or GCS)
    try {
      // Get signed URL for upload
      const signedUrlResponse = (await apiCall(
        "/upload/signed-url-for-upload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contentType: file.type,
          }),
        },
      )) as SignedUploadUrlResponse;

      const { signedUrl, fileUrl } = signedUrlResponse;

      // Upload directly to cloud storage using signed URL
      const uploadResponse = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(
          `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
        );
      }

      fileURL = fileUrl;
    } catch (e) {
      throw new Error("Failed to upload file via signed URL: " + e.message);
    }
  }

  return {
    fileURL: fileURL.match(/^\//) ? getApiHost() + fileURL : fileURL,
  };
}

/**
 * Save the text content as a file with the given file name.
 * @param textContent
 * @param fileName
 */
export function saveAs({
  textContent,
  fileName,
}: {
  textContent: string;
  fileName: string;
}) {
  const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.download = fileName;
  a.href = URL.createObjectURL(blob);
  a.click();
}
