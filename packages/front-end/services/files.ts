import { ApiCallType } from "./auth";
import { getApiHost } from "./env";

export async function uploadFile(
  apiCall: ApiCallType<{ uploadURL: string; fileURL: string }>,
  file: File
) {
  console.log("file", file);
  console.log("got to the uploadFile method");
  const ext = file.name.split(".").reverse()[0];
  console.log("ext", ext);
  const { uploadURL, fileURL } = await apiCall(`/file/upload/${ext}`, {
    method: "POST",
  });

  const res = await fetch(
    uploadURL.match(/^\//) ? getApiHost() + uploadURL : uploadURL,
    {
      method: "GET",
      headers: {
        "Content-Type": file.type,
      },
      // body: file,
    }
  );

  console.log("res", res);

  if (!res.ok) {
    throw new Error("Failed to upload file brochacho");
  }

  return {
    fileURL: fileURL.match(/^\//) ? getApiHost() + fileURL : fileURL,
  };
}
