import { ApiCallType } from "./auth";
import { getApiHost } from "./env";

export async function uploadFile(
  apiCall: ApiCallType<{ fileURL: string }>,
  file: File
) {
  let fileURL = "";
  try {
    ({ fileURL } = await apiCall("/upload", {
      method: "PUT",

      headers: {
        "Content-Type": file.type,
      },
      body: file,
    }));
  } catch (e) {
    throw new Error("Failed to upload file: " + e.message);
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
