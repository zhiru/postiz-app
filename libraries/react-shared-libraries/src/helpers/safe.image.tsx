'use client';

import { FC, Ref } from 'react';
import { ImageProps } from 'next/image';

type SafeImageProps = Omit<ImageProps, 'src'> & {
  src: string;
  ref?: Ref<HTMLImageElement>;
};

const SafeImage: FC<SafeImageProps> = ({
  src,
  alt,
  width,
  height,
  className,
  style,
  onError,
}) => {
  return (
    <img
      ref={ref}
      src={src}
      alt={alt?.toString() || ''}
      width={typeof width === 'number' ? width : undefined}
      height={typeof height === 'number' ? height : undefined}
      className={className}
      style={style}
      onError={onError}
    />
  );
};

export default SafeImage;
