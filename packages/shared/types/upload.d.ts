export interface SignedImageUrlResponse {
  signedUrl: string;
  expiresAt: string;
}

export interface SignedUploadUrlResponse {
  signedUrl: string;
  fileUrl: string;
  filePath: string;
  expiresAt: string;
  fields?: Record<string, string>; // For S3 POST form fields
}

export interface UploadResponse {
  status: number;
  fileURL: string;
}
