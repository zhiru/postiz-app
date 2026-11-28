'use client';

import { FC, useEffect, useRef, useState } from 'react';
import SafeImage from './safe.image';
interface ImageSrc {
  src: string;
  fallbackSrc: string;
  width: number;
  height: number;
  [key: string]: any;
}
const ImageWithFallback: FC<ImageSrc> = (props) => {
  const { src, fallbackSrc, ...rest } = props;
  const [imgSrc, setImgSrc] = useState(src);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (src !== imgSrc) {
      setImgSrc(src);
    }
  }, [src]);
  useEffect(() => {
    // A server-rendered image can fail before React attaches its error handler.
    if (image.current?.complete && image.current.naturalWidth === 0) {
      setImgSrc(fallbackSrc);
    }
  }, [imgSrc, fallbackSrc]);
  return (
    <SafeImage
      ref={image}
      alt=""
      {...rest}
      src={imgSrc}
      onError={() => {
        setImgSrc(fallbackSrc);
      }}
    />
  );
};
export default ImageWithFallback;
