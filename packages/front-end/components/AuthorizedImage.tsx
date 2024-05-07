import React, { useEffect, useState, FC } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import {
  getApiHost,
  getGcsDomain,
  getS3Domain,
  usingFileProxy,
} from "@/services/env";
import LoadingSpinner from "./LoadingSpinner";

interface AuthorizedImageProps extends React.HTMLProps<HTMLImageElement> {
  imageCache?: Record<string, string>;
}

/**
 * This component is used to display images that are stored in a private bucket.
 * It will fetch the image from the backend and convert it to a blob url that can be displayed.
 * It will also cache the image if imageCache is set so that it does not need to be fetched again.
 * */
const AuthorizedImage: FC<AuthorizedImageProps> = ({
  imageCache = {},
  src = "",
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { apiCall } = useAuth();

  useEffect(() => {
    const fetchData = async (src, apiUrl) => {
      try {
        const imageData: Blob = await apiCall(new URL(apiUrl).pathname);
        const imageUrl = URL.createObjectURL(imageData);
        imageCache[src] = imageUrl;
        setImageSrc(imageUrl);
      } catch (error) {
        setError(error.message);
      }
    };

    navigator.locks.request(src, async () => {
      if (imageCache[src]) {
        // Images in the cache do not need to be fetched again
        setImageSrc(imageCache[src]);
      } else if (
        usingFileProxy() &&
        getGcsDomain() &&
        src.startsWith(getGcsDomain())
      ) {
        // We convert GCS images to the GB url that acts as a proxy using the correct credentials
        // This way they can lock their bucket down to only allow access from the proxy.
        const withoutDomain = src.replace(
          "https://storage.googleapis.com/",
          "",
        );
        const parts = withoutDomain.split("/");
        parts.shift(); // remove bucket name
        const apiUrl = getApiHost() + "/upload/" + parts.join("/");
        await fetchData(src, apiUrl);
      } else if (
        usingFileProxy() &&
        getS3Domain() &&
        src.startsWith(getS3Domain())
      ) {
        // We convert s3 images to the GB url that acts as a proxy using the correct credentials
        // This way they can lock their bucket down to only allow access from the proxy.
        const apiUrl =
          getApiHost() + "/upload/" + src.substring(getS3Domain().length);
        await fetchData(src, apiUrl);
      } else if (!src.startsWith(getApiHost())) {
        // Images in markdown that are not from our host we will treat as a normal image
        setImageSrc(src);
      } else {
        // Images to the proxy we will fetch from the backend
        const apiUrl = src;
        await fetchData(src, apiUrl);
      }
    });
  }, [src, imageCache, apiCall]);

  if (error) {
    return (
      <div>
        <FaExclamationTriangle
          size={14}
          className="text-danger ml-1"
          style={{ marginTop: -4 }}
        />
        <span> Error: {error} </span>{" "}
      </div>
    );
  }

  if (!imageSrc) {
    return <LoadingSpinner />;
  }

  return <img src={imageSrc} {...props} crossOrigin="" />;
};

export default AuthorizedImage;
