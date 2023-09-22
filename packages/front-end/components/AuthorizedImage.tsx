import React, { useEffect, useState, FC, CSSProperties } from "react";
import { useAuth } from "@/services/auth";

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
    return <div>Error: {error}</div>;
  }

  if (!imageSrc) {
    return <div>Loading...</div>;
  }

  return <img src={imageSrc} className={className} style={style} />;
};

export default AuthorizedImage;
