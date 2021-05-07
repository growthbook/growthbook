export function dataURItoBlob(dataURI: string): Blob {
  // convert base64 to raw binary data held in a string
  // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
  const byteString = atob(dataURI.split(",")[1]);

  // separate out the mime component
  const mimeString = dataURI.split(",")[0].split(":")[1].split(";")[0];

  // write the bytes of the string to an ArrayBuffer
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

export function addQueryStringToURL(url: string): string {
  const [urlPart, anchor] = url.split("#", 2);

  if (urlPart.indexOf("?") === -1) {
    return urlPart + "?growthbookVisualDesigner" + (anchor ? "#" + anchor : "");
  }
  return urlPart + "&growthbookVisualDesigner" + (anchor ? "#" + anchor : "");
}
