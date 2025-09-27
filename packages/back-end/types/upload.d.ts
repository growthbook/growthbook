export interface SignedImageUrlResponse {
  signedUrl: string;
  expiresAt: string;
}

export interface SignedUploadUrlResponse {
  signedUrl: string;
  fileUrl: string;
  filePath: string;
  expiresAt: string;
}

export interface UploadResponse {
  status: number;
  fileURL: string;
}
