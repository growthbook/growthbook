import { ApiCallType } from "./auth";
import { getApiHost } from "./utils";

const apiHost = getApiHost();

export async function uploadFile(
  apiCall: ApiCallType<{ uploadURL: string; fileURL: string }>,
  file: File
) {
  const ext = file.name.split(".").reverse()[0];
  const { uploadURL, fileURL } = await apiCall(`/upload/${ext}`, {
    method: "POST",
  });

  const res = await fetch(
    uploadURL.match(/^\//) ? apiHost + uploadURL : uploadURL,
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
    fileURL: fileURL.match(/^\//) ? apiHost + fileURL : fileURL,
  };
}
