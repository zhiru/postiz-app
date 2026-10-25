'use client';

import { createContext, useContext } from 'react';
import { Menu } from '@mantine/core';
import { Node, useReactFlow } from '@xyflow/react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const FlowNodeActionsContext = createContext<{
  edit: (node: Node | null) => void;
  disabled: boolean;
}>({ edit: () => undefined, disabled: false });

export const FlowNodeActions = ({ id }: { id: string }) => {
  const t = useT();
  const { getNode, setNodes, setEdges } = useReactFlow();
  const { edit, disabled } = useContext(FlowNodeActionsContext);
  const trigger = getNode(id)?.type === 'trigger';
  return (
    <div
      className="nodrag nopan ml-auto"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Menu
        position="bottom-end"
        withinPortal
        shadow="md"
        zIndex={10000}
        width={200}
        styles={{
          item: {
            '&[data-hovered]': { backgroundColor: 'var(--new-box-hover)' },
          },
        }}
      >
        <Menu.Target>
          <button
            type="button"
            disabled={disabled}
            aria-label={t('flow_step_actions', 'Step actions')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-textColor hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-40"
          >
            ⋯
          </button>
        </Menu.Target>
        <Menu.Dropdown
          style={{
            backgroundColor: 'var(--new-bgColorInner)',
            borderColor: 'var(--new-table-border)',
          }}
        >
          <Menu.Item
            style={{ color: 'var(--new-btn-text)' }}
            onClick={() => edit(getNode(id) || null)}
          >
            {t('flow_step_edit', 'Edit step')}
          </Menu.Item>
          <Menu.Item
            style={{ color: 'var(--new-btn-text)' }}
            disabled={trigger}
            onClick={() => {
              const source = getNode(id);
              if (!source || source.type === 'trigger') return;
              const copy = {
                ...source,
                id: `temp-${crypto.randomUUID()}`,
                position: {
                  x: source.position.x + 300,
                  y: source.position.y + 50,
                },
                selected: false,
                dragging: false,
                data: structuredClone(source.data),
              };
              setNodes((nodes) => [...nodes, copy]);
              edit(copy);
            }}
          >
            {t('flow_step_duplicate', 'Duplicate step')}
          </Menu.Item>
          <Menu.Item
            color="red"
            disabled={trigger}
            onClick={() => {
              if (getNode(id)?.type === 'trigger') return;
              setEdges((edges) =>
                edges.filter((edge) => edge.source !== id && edge.target !== id)
              );
              setNodes((nodes) => nodes.filter((node) => node.id !== id));
              edit(null);
            }}
          >
            {t('flow_step_delete', 'Delete step')}
          </Menu.Item>
          {trigger && (
            <Menu.Label>
              {t('flow_step_trigger_required', 'Keep one trigger per flow')}
            </Menu.Label>
          )}
        </Menu.Dropdown>
      </Menu>
    </div>
  );
};
