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

  const isGoogle = uploadURL.substr(16, 6); //TODO: This needs to be updated, but I've not yet figured out how to access the UPLOAD_METHOD constant set on the backend.

  const res = await fetch(
    uploadURL.match(/^\//) ? getApiHost() + uploadURL : uploadURL,
    {
      method: "GET",
      headers: {
        "Content-Type": file.type,
      },
      ...(isGoogle === "google" && { body: file }), // TODO: We can't send Google a body.
    }
  );

  if (!res.ok) {
    throw new Error("Failed to upload file brochacho");
  }

  return {
    fileURL: fileURL.match(/^\//) ? getApiHost() + fileURL : fileURL,
  };
}
