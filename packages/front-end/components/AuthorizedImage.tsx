import React, { useEffect, useState, FC, CSSProperties } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "./LoadingSpinner";

interface AuthorizedImageProps {
  imagePath: string;
  className?: string;
  style?: CSSProperties;
}

const AuthorizedImage: FC<AuthorizedImageProps> = ({
  imagePath,
  className,
  style,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { apiCall } = useAuth();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const imageData: Blob = await apiCall(new URL(imagePath).pathname);
        const imageUrl = URL.createObjectURL(imageData);
        setImageSrc(imageUrl);
      } catch (error) {
        setError(error.message);
      }
    };
    fetchData();
  }, [imagePath, apiCall]);

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

  return <img src={imageSrc} className={className} style={style} />;
};

export default AuthorizedImage;
