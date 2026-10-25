'use client';
import { FC } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const FlowMessagePreview: FC<{
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}> = ({ nodes, edges, onClose }) => {
  const t = useT();
  const ordered: Array<{ node: Node; branch?: string }> = [];
  const visit = (id: string, path: Set<string>, branch?: string) => {
    if (path.has(id) || path.size >= 50) return;
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    ordered.push({ node, branch });
    for (const edge of edges.filter((e) => e.source === id))
      visit(
        edge.target,
        new Set([...path, id]),
        edge.sourceHandle || undefined
      );
  };
  const trigger = nodes.find((n) => n.type === 'trigger');
  if (trigger) visit(trigger.id, new Set());
  return (
    <aside
      role="region"
      aria-label={t('flow_preview', 'Message preview')}
      className="absolute right-0 top-0 z-20 h-full w-[min(400px,100%)] overflow-y-auto border-l border-newTableBorder bg-newBgColorInner p-4 shadow-menu"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold text-textColor">
          {t('flow_preview', 'Message preview')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close', 'Close')}
          className="rounded p-2 text-textColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
        >
          ×
        </button>
      </div>
      <p className="text-xs text-tableText mb-5">
        {t(
          'flow_preview_hint',
          'Preview only. Nothing is sent. Conditions display both possible branches.'
        )}
      </p>
      <ol className="space-y-4">
        {ordered.map(({ node, branch }, index) => {
          let config: any = {};
          try {
            config =
              typeof node.data.config === 'string'
                ? JSON.parse(node.data.config)
                : node.data.config || {};
          } catch {
            /* incomplete draft */
          }
          const media = config.media;
          return (
            <li key={`${index}:${node.id}`} className="text-sm text-textColor">
              {branch && (
                <span className="block text-xs text-tableText mb-1">
                  {branch === 'match'
                    ? t('flow_branch_match', 'Matches')
                    : t('flow_branch_no_match', 'Does not match')}
                </span>
              )}
              {node.type === 'sendDm' ? (
                <div className="ml-8 rounded-2xl rounded-tr-sm border border-newTableBorder bg-btnSimple p-3 whitespace-pre-wrap break-words">
                  {media ? (
                    <>
                      <div className="text-xs text-tableText mb-2">
                        {media.type === 'video'
                          ? t('flow_video', 'Video')
                          : t('flow_image', 'Image')}
                      </div>
                      {media.path && /^https:\/\//.test(media.path) ? (
                        media.type === 'video' ? (
                          <video
                            src={media.path}
                            controls
                            preload="metadata"
                            className="max-h-52 rounded-lg"
                          />
                        ) : (
                          <img
                            src={media.path}
                            alt={t('flow_image', 'Image')}
                            className="max-h-52 rounded-lg object-contain"
                          />
                        )
                      ) : (
                        t('flow_choose_media', 'Choose media from the library')
                      )}
                    </>
                  ) : (
                    config.message ||
                    config.template ||
                    t('flow_empty_message', 'Write the message')
                  )}
                  {config.buttonText && (
                    <div className="mt-3 rounded border border-newTableBorder p-2 text-center text-xs">
                      {config.buttonText}
                    </div>
                  )}
                </div>
              ) : (
                <div className="border-l-2 border-newTableBorder pl-3 text-xs text-tableText">
                  {node.type === 'waitReply'
                    ? `${t('flow_wait_reply', 'Wait for reply')} · ${
                        config.timeoutHours || 24
                      } h`
                    : node.type === 'delay'
                    ? `${t('node_delay', 'Delay')} · ${config.duration || 0} ${
                        config.unit || 'seconds'
                      }`
                    : node.type === 'condition'
                    ? t('node_condition', 'Condition')
                    : node.type === 'replyComment'
                    ? `${t('node_reply', 'Reply comment')}: ${
                        config.message || ''
                      }`
                    : t('node_trigger', 'Trigger')}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
};
