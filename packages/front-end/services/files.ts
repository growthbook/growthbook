import { ApiCallType } from "./auth";
import { getApiHost } from "./env";

export async function uploadFile(
  apiCall: ApiCallType<{ uploadURL: string; fileURL: string }>,
  file: File
) {
  const ext = file.name.split(".").reverse()[0];
  const { uploadURL, fileURL } = await apiCall(`/file/upload/${ext}`, {
    method: "POST",
  });

  const res = await fetch(
    uploadURL.match(/^\//) ? getApiHost() + uploadURL : uploadURL,
    {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    }
  );

  if (!res.ok) {
    throw new Error("Failed to upload file");
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
