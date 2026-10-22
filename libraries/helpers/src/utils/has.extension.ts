export const hasExtension = (
  path: string | undefined | null,
  extension: string
): boolean => {
  if (!path) {
    return false;
  }
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return path.toLowerCase().indexOf(ext.toLowerCase()) > -1;
};

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

export const isVideo = (path?: string | null): boolean => {
  const pathname = path?.split(/[?#]/, 1)[0].toLowerCase();
  return (
    !!pathname &&
    VIDEO_EXTENSIONS.some((extension) => pathname.endsWith(`.${extension}`))
  );
};
