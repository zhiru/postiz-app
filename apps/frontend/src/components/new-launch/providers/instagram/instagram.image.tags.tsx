'use client';

import { FC, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import type { ImageUserTag } from '@gitroom/nestjs-libraries/dtos/media/media.dto';

const ImageTagsEditor: FC<{
  path: string;
  tags: ImageUserTag[];
  disabled: boolean;
  onChange: (tags: ImageUserTag[]) => void;
}> = ({ path, tags, disabled, onChange }) => {
  const t = useT();
  const mediaDirectory = useMediaDirectory();
  const [username, setUsername] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const updatePosition = (index: number, axis: 'x' | 'y', value: number) => {
    onChange(
      tags.map((tag, i) => (i === index ? { ...tag, [axis]: value } : tag))
    );
  };
  const isImage = !hasExtension(path, 'mp4');
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-tableBorder p-3">
      {isImage && (
        <div className="relative self-start max-w-full">
          <button
            type="button"
            disabled={disabled || !tags[selected]}
            aria-label={t(
              'instagram_tags_position',
              'Click to position the selected person; use X/Y fields with a keyboard'
            )}
            className="block max-w-full"
            onClick={(event) => {
              if (event.detail === 0) return;
              const rect = event.currentTarget.getBoundingClientRect();
              onChange(
                tags.map((tag, index) =>
                  index === selected
                    ? {
                        ...tag,
                        x: Math.max(
                          0,
                          Math.min(1, (event.clientX - rect.left) / rect.width)
                        ),
                        y: Math.max(
                          0,
                          Math.min(1, (event.clientY - rect.top) / rect.height)
                        ),
                      }
                    : tag
                )
              );
            }}
          >
            <img
              src={mediaDirectory.set(path)}
              alt={t('instagram_tags_preview', 'Image to tag people')}
              className="max-h-64 max-w-full w-auto h-auto"
            />
          </button>
          {tags.map((tag, index) => (
            <span
              key={tag.username}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-black/80 px-1 text-xs text-white"
              style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
            >
              {index === selected ? '● ' : ''}@{tag.username}
            </span>
          ))}
        </div>
      )}
      {disabled && (
        <p role="status">
          {t(
            'instagram_tags_unsupported',
            'People tags are supported only on feed images. Remove tags before switching to a story or video.'
          )}
        </p>
      )}
      {tags.map((tag, index) => (
        <div key={tag.username} className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
            className="underline"
          >
            @{tag.username}
          </button>
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis} className="flex flex-col">
              {axis === 'x'
                ? t('instagram_tags_x', 'X (0 left, 1 right)')
                : t('instagram_tags_y', 'Y (0 top, 1 bottom)')}
              <input
                type="number"
                required
                min={0}
                max={1}
                step="any"
                disabled={disabled}
                value={Number.isFinite(tag[axis]) ? tag[axis] : ''}
                aria-invalid={
                  !Number.isFinite(tag[axis]) || tag[axis] < 0 || tag[axis] > 1
                }
                onFocus={() => setSelected(index)}
                onChange={(event) =>
                  updatePosition(index, axis, event.target.valueAsNumber)
                }
                className="w-28 rounded border border-tableBorder bg-newBgColorInner p-2"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(tags.filter((_, i) => i !== index));
              setSelected(0);
            }}
            className="underline"
          >
            {t('instagram_tags_remove', 'Remove person')}
          </button>
          {(!Number.isFinite(tag.x) ||
            !Number.isFinite(tag.y) ||
            tag.x < 0 ||
            tag.x > 1 ||
            tag.y < 0 ||
            tag.y > 1) && (
            <p role="alert">
              {t(
                'instagram_tags_coordinates_error',
                'X and Y must be numbers between 0 and 1.'
              )}
            </p>
          )}
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            {t('instagram_tags_username', 'Instagram username')}
            <input
              type="text"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError('');
              }}
              className="rounded border border-tableBorder bg-newBgColorInner p-2"
              aria-invalid={!!error}
            />
          </label>
          <button
            type="button"
            className="underline"
            onClick={() => {
              const handle = username.trim().replace(/^@/, '');
              if (
                !/^[A-Za-z0-9._]{1,30}$/.test(handle) ||
                tags.some(
                  (tag) => tag.username.toLowerCase() === handle.toLowerCase()
                )
              ) {
                setError(
                  t(
                    'instagram_tags_username_error',
                    'Enter a valid username that is not already tagged on this image.'
                  )
                );
                return;
              }
              onChange([...tags, { username: handle, x: 0.5, y: 0.5 }]);
              setSelected(tags.length);
              setUsername('');
              setError('');
            }}
          >
            {t('instagram_tags_add', 'Add person')}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
};

export const InstagramImageTags: FC<{ isStory: boolean }> = ({ isStory }) => {
  const t = useT();
  const { integration } = useIntegration();
  const { global, internal, addRemoveInternal, setInternalValueMedia } =
    useLaunchStore(
      useShallow((state) => ({
        global: state.global,
        internal: state.internal.find(
          (item) => item.integration.id === integration?.id
        ),
        addRemoveInternal: state.addRemoveInternal,
        setInternalValueMedia: state.setInternalValueMedia,
      }))
    );
  const media = (internal?.integrationValue || global)[0]?.media || [];
  if (!integration || !media.length) return null;
  return (
    <div className="mt-[18px] flex flex-col gap-3">
      <p>{t('instagram_tags_title', 'People tagged in images')}</p>
      <p className="text-sm">
        {t(
          'instagram_tags_description',
          'Tags appear on each image and do not invite collaborators. Select a person, then click the image or edit X/Y.'
        )}
      </p>
      {media.map(
        (item) =>
          (!hasExtension(item.path, 'mp4') || item.user_tags?.length) && (
            <ImageTagsEditor
              key={item.id}
              path={item.path}
              tags={item.user_tags || []}
              disabled={isStory || hasExtension(item.path, 'mp4')}
              onChange={(tags) => {
                // Customize this channel before changing its per-image metadata.
                if (!internal) addRemoveInternal(integration.id);
                setInternalValueMedia(
                  integration.id,
                  0,
                  media.map((image) =>
                    image.id === item.id ? { ...image, user_tags: tags } : image
                  )
                );
              }}
            />
          )
      )}
    </div>
  );
};
