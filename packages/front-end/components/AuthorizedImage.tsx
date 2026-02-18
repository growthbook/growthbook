import React, { useEffect, useState, FC } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { SignedImageUrlResponse } from "shared/types/upload";
import { useAuth } from "@/services/auth";
import { getApiHost, getGcsDomain, getS3Domain } from "@/services/env";
import LoadingSpinner from "./LoadingSpinner";

interface AuthorizedImageProps extends React.HTMLProps<HTMLImageElement> {
  imageCache?: Record<string, { url: string; expiresAt: string }>;
  onErrorMsg?: (msg: string) => React.ReactNode | null;
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
}

/**
 * This component is used to display images that may be stored in private buckets.
 * For S3 and GCS, it fetches signed URLs from the backend for direct access.
 * For local storage it fetches it from api server and external images, it uses them directly.
 * It caches signed and local URLs to avoid repeated API calls.
 * */
const AuthorizedImage: FC<AuthorizedImageProps> = ({
  imageCache = {},
  onErrorMsg,
  src = "",
  isPublic = false,
  shareUid,
  shareType = "experiment",
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { apiCall } = useAuth();

  useEffect(() => {
    const fetchData = async (src) => {
      try {
        const imageData: Blob = await apiCall(new URL(src).pathname);
        const imageUrl = URL.createObjectURL(imageData);
        imageCache[src] = { url: imageUrl, expiresAt: "never" }; // Local files never expire
        setImageSrc(imageUrl);
      } catch (e) {
        setErrorMsg(e.message);
      }
    };

    const fetchSignedUrl = async (originalSrc: string, path: string) => {
      try {
        let endpoint = isPublic
          ? `/upload/public-signed-url/${path}`
          : `/upload/signed-url/${path}`;

        // Add shareUid and shareType as query parameters for public endpoints
        if (isPublic && shareUid) {
          endpoint += `?shareUid=${encodeURIComponent(shareUid)}&shareType=${encodeURIComponent(shareType)}`;
        }

        let response: SignedImageUrlResponse;

        if (isPublic) {
          // For public endpoints, use fetch without credentials to avoid CORS issues
          const res = await fetch(getApiHost() + endpoint);
          if (!res.ok) {
            const errorData = await res
              .json()
              .catch(() => ({ message: res.statusText }));
            throw new Error(
              errorData.message ||
                `Failed to fetch signed URL: ${res.statusText}`,
            );
          }
          response = await res.json();
        } else {
          // For authenticated endpoints, use apiCall which includes credentials
          response = await apiCall<SignedImageUrlResponse>(endpoint);
        }

        const { signedUrl, expiresAt } = response;

        imageCache[originalSrc] = { url: signedUrl, expiresAt };
        setImageSrc(signedUrl);
      } catch (e) {
        console.error("Error fetching signed URL:", e);
        setErrorMsg(e.message);
      }
    };

    const isExpired = (expiresAt: string): boolean => {
      if (expiresAt === "never") return false;
      return new Date(expiresAt) <= new Date();
    };

    navigator.locks.request(src, async () => {
      if (imageCache[src] && !isExpired(imageCache[src].expiresAt)) {
        // Use cached URL if not expired
        setImageSrc(imageCache[src].url);
      } else if (getGcsDomain() && src.startsWith(getGcsDomain())) {
        // Extract path for GCS images and get signed URL
        const withoutDomain = src.replace(
          "https://storage.googleapis.com/",
          "",
        );
        const parts = withoutDomain.split("/");
        parts.shift(); // remove bucket name
        const path = parts.join("/");
        await fetchSignedUrl(src, path);
      } else if (getS3Domain() && src.startsWith(getS3Domain())) {
        // Extract path for S3 images and get signed URL
        const s3Domain = getS3Domain();

        // Handle both with and without trailing slash in domain
        const domainToRemove = s3Domain.endsWith("/")
          ? s3Domain
          : s3Domain + "/";
        const path = src.substring(domainToRemove.length);

        await fetchSignedUrl(src, path);
      } else if (src.startsWith(getApiHost() + "/upload/")) {
        // This is a local upload - serve directly (no signed URL needed for local files)
        await fetchData(src);
      } else {
        // External images or already public URLs - use directly (don't cache to avoid issues)
        // Note: We don't cache these because they might be signed URLs or external URLs
        // that could change or expire
        setImageSrc(src);
      }
    });
  }, [src, imageCache, apiCall, isPublic, shareUid, shareType]);

  if (errorMsg) {
    if (onErrorMsg) {
      return onErrorMsg(errorMsg);
    }
    return (
      <span {...props} style={{ ...props.style, display: "inline-block" }}>
        <FaExclamationTriangle
          size={14}
          className="text-danger ml-1"
          style={{ marginTop: -2 }}
        />
        <span className="ml-2"> Error: {errorMsg} </span>{" "}
      </span>
    );
  }

  if (!imageSrc) {
    return (
      <span {...props} style={{ ...props.style, display: "inline-block" }}>
        <LoadingSpinner className={"center"} />
      </span>
    );
  }

  return <img src={imageSrc} {...props} crossOrigin="" />;
};

export default AuthorizedImage;
