'use client';

import {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
  DragEvent,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useFlow } from '@gitroom/frontend/components/automations/hooks/use-flows';
import { useRouter } from 'next/navigation';
import { TriggerNode } from '@gitroom/frontend/components/automations/nodes/trigger-node';
import { ConditionNode } from '@gitroom/frontend/components/automations/nodes/condition-node';
import { ReplyCommentNode } from '@gitroom/frontend/components/automations/nodes/reply-comment-node';
import { SendDmNode } from '@gitroom/frontend/components/automations/nodes/send-dm-node';
import { DelayNode } from '@gitroom/frontend/components/automations/nodes/delay-node';
import { DeletableEdge } from '@gitroom/frontend/components/automations/nodes/deletable-edge';
import { FlowMessagePreview } from './flow-message-preview';
import { FlowNodeActionsContext } from './nodes/flow-node-actions';
import { NodeConfigPanel } from '@gitroom/frontend/components/automations/node-config-panel';
import { FlowExecutionsComponent } from '@gitroom/frontend/components/automations/flow-executions.component';
import { FlowSummaryComponent } from '@gitroom/frontend/components/automations/flow-summary.component';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useToaster } from '@gitroom/react/toaster/toaster';

const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  replyComment: ReplyCommentNode,
  sendDm: SendDmNode,
  delay: DelayNode,
  waitReply: DelayNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

const defaultEdgeOptions = { type: 'deletable' };

const NODE_TYPE_MAP: Record<string, string> = {
  TRIGGER: 'trigger',
  CONDITION: 'condition',
  REPLY_COMMENT: 'replyComment',
  SEND_DM: 'sendDm',
  DELAY: 'delay',
};

const REVERSE_NODE_TYPE_MAP: Record<string, string> = {
  trigger: 'TRIGGER',
  condition: 'CONDITION',
  replyComment: 'REPLY_COMMENT',
  sendDm: 'SEND_DM',
  delay: 'DELAY',
  waitReply: 'DELAY',
};

const NODE_TOOLBAR_CONFIG = [
  {
    type: 'trigger',
    color: '#22c55e',
    labelKey: 'node_trigger',
    label: 'Trigger',
    descKey: 'node_trigger_desc',
    desc: 'Instagram comment',
  },
  {
    type: 'condition',
    color: '#eab308',
    labelKey: 'node_condition',
    label: 'Condition',
    descKey: 'node_condition_desc',
    desc: 'Filter by keywords',
  },
  {
    type: 'replyComment',
    color: '#3b82f6',
    labelKey: 'node_reply',
    label: 'Reply Comment',
    descKey: 'node_reply_desc',
    desc: 'Public reply',
  },
  {
    type: 'sendDm',
    color: '#a855f7',
    labelKey: 'node_dm',
    label: 'Send DM',
    descKey: 'node_dm_desc',
    desc: 'Private message',
  },
  {
    type: 'sendDm',
    kind: 'image',
    color: '#a855f7',
    labelKey: 'flow_image',
    label: 'Image',
    descKey: 'flow_image_desc',
    desc: 'Send from the media library',
  },
  {
    type: 'sendDm',
    kind: 'video',
    color: '#a855f7',
    labelKey: 'flow_video',
    label: 'Video',
    descKey: 'flow_video_desc',
    desc: 'Send from the media library',
  },
  {
    type: 'waitReply',
    color: '#14b8a6',
    labelKey: 'flow_wait_reply',
    label: 'Wait for reply',
    descKey: 'flow_wait_reply_desc',
    desc: 'Continue when the person replies',
  },
  {
    type: 'delay',
    color: '#f97316',
    labelKey: 'node_delay',
    label: 'Delay',
    descKey: 'node_delay_desc',
    desc: 'Wait before next',
  },
];

const viewType = (node: any) => {
  try {
    if (node.type === 'DELAY' && JSON.parse(node.data || '{}').mode === 'reply')
      return 'waitReply';
  } catch {
    /* show the original node for malformed configuration */
  }
  return NODE_TYPE_MAP[node.type] || 'trigger';
};
const newConfig = (type: string, kind?: string) =>
  type === 'waitReply'
    ? { mode: 'reply', timeoutHours: 24 }
    : kind
    ? { media: { type: kind, id: '' } }
    : type === 'delay'
    ? { duration: 1, unit: 'minutes' }
    : {};

interface FlowEditorProps {
  id: string;
}

const FlowEditorInner: FC<FlowEditorProps> = ({ id }) => {
  const t = useT();
  const { screenToFlowPosition } = useReactFlow();
  const fetchApi = useFetch();
  const router = useRouter();
  const toaster = useToaster();
  const { data: flow, isLoading, mutate } = useFlow(id);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [sequence, setSequence] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [flowName, setFlowName] = useState('');
  const [viewMode, setViewMode] = useState<'summary' | 'advanced' | null>(null);

  const initialNodes = useMemo(() => {
    if (!flow?.nodes) return [];
    return flow.nodes.map((n: any) => ({
      id: n.id,
      type: viewType(n),
      deletable: n.type !== 'TRIGGER',
      position: { x: n.positionX, y: n.positionY },
      data: { label: n.label, config: n.data },
    }));
  }, [flow?.nodes]);

  const initialEdges = useMemo(() => {
    if (!flow?.edges) return [];
    return flow.edges.map((e: any) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourceHandle || undefined,
      type: 'deletable',
    }));
  }, [flow?.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes/edges when flow data first arrives (initialNodes/initialEdges are empty on first render)
  useEffect(() => {
    if (!flow?.id) return;
    setSequence(
      flow.nodes.some((n: any) => {
        try {
          return (
            n.type === 'TRIGGER' &&
            JSON.parse(n.data || '{}').executionVersion === 2
          );
        } catch {
          return false;
        }
      })
    );
    setNodes(
      (flow.nodes ?? []).map((n: any) => ({
        id: n.id,
        type: viewType(n),
        deletable: n.type !== 'TRIGGER',
        position: { x: n.positionX, y: n.positionY },
        data: { label: n.label, config: n.data },
      }))
    );
    setEdges(
      (flow.edges ?? []).map((e: any) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle: e.sourceHandle || undefined,
        type: 'deletable',
      }))
    );
  }, [flow?.id, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      // Block DM → DM direct connection (Meta only allows 1 private reply per comment)
      const sourceNode = nodes.find((n) => n.id === params.source);
      const targetNode = nodes.find((n) => n.id === params.target);
      if (
        !sequence &&
        sourceNode?.type === 'sendDm' &&
        targetNode?.type === 'sendDm'
      ) {
        toaster.show(
          t(
            'dm_single_limit',
            'A Meta permite apenas 1 mensagem direta por comentario. Use quebras de linha no campo de mensagem para enviar multiplas linhas.'
          ),
          'warning'
        );
        return;
      }
      setEdges((eds) => addEdge(params, eds));
    },
    [setEdges, nodes, toaster, t, sequence]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/reactflow');
      const [type, kind] = raw.split(':');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNodeId = `temp-${crypto.randomUUID()}`;
      const newNode: Node = {
        id: newNodeId,
        type,
        deletable: type !== 'trigger',
        position,
        data: { label: type, config: JSON.stringify(newConfig(type, kind)) },
      };

      setNodes((nds) => {
        // Find last added node (highest Y, or last in array) to auto-connect
        const lastNode = nds.length > 0 ? nds[nds.length - 1] : null;
        const shouldAutoConnect =
          lastNode &&
          type !== 'trigger' &&
          // Block DM → DM auto-connect (Meta 1 private reply limit)
          (sequence || !(lastNode.type === 'sendDm' && type === 'sendDm'));

        if (shouldAutoConnect) {
          const edgeData: Edge = {
            id: `e-${lastNode.id}-${newNodeId}`,
            source: lastNode.id,
            target: newNodeId,
            type: 'deletable',
          };
          // Condition nodes need sourceHandle to identify match/no_match path
          if (lastNode.type === 'condition') {
            edgeData.sourceHandle = 'match';
          }
          setEdges((eds) => [...eds, edgeData]);
        }

        if (!sequence && lastNode?.type === 'sendDm' && type === 'sendDm') {
          toaster.show(
            t(
              'dm_single_limit',
              'A Meta permite apenas 1 mensagem direta por comentario. Use quebras de linha no campo de mensagem para enviar multiplas linhas.'
            ),
            'warning'
          );
        }

        return [...nds, newNode];
      });
    },
    [setNodes, setEdges, screenToFlowPosition, sequence]
  );

  const onDragStart = useCallback((event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleAddNode = useCallback(
    (type: string, kind?: string) => {
      setNodes((nds) => {
        const lastNode = nds.length > 0 ? nds[nds.length - 1] : null;
        const position = lastNode
          ? { x: lastNode.position.x, y: lastNode.position.y + 150 }
          : { x: 250, y: 50 };

        const newNodeId = `temp-${crypto.randomUUID()}`;
        const newNode: Node = {
          id: newNodeId,
          type,
          position,
          data: { label: type, config: JSON.stringify(newConfig(type, kind)) },
        };

        const shouldAutoConnect =
          lastNode &&
          type !== 'trigger' &&
          (sequence || !(lastNode.type === 'sendDm' && type === 'sendDm'));

        if (shouldAutoConnect) {
          const edgeData: Edge = {
            id: `e-${lastNode.id}-${newNodeId}`,
            source: lastNode.id,
            target: newNodeId,
            type: 'deletable',
          };
          if (lastNode.type === 'condition') {
            edgeData.sourceHandle = 'match';
          }
          setEdges((eds) => [...eds, edgeData]);
        }

        if (!sequence && lastNode?.type === 'sendDm' && type === 'sendDm') {
          toaster.show(
            t(
              'dm_single_limit',
              'A Meta permite apenas 1 mensagem direta por comentario. Use quebras de linha no campo de mensagem para enviar multiplas linhas.'
            ),
            'warning'
          );
        }

        return [...nds, newNode];
      });
    },
    [setNodes, setEdges, toaster, t, sequence]
  );

  const handleNodeUpdate = useCallback(
    (nodeId: string, config: Record<string, any>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, config: JSON.stringify(config) } }
            : n
        )
      );
      setSelectedNode(null);
    },
    [setNodes]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const canvasNodes = nodes.map((n) => {
        let rawData =
          typeof n.data?.config === 'string'
            ? n.data.config
            : JSON.stringify(n.data?.config || {});
        const backendType = REVERSE_NODE_TYPE_MAP[n.type || 'trigger'];
        // For TRIGGER nodes, derive the label from the trigger type in the
        // config JSON so webhook filters stay in sync. Other node types keep
        // whatever label the user assigned (or none).
        let label =
          typeof n.data?.label === 'string' ? n.data.label : undefined;
        if (backendType === 'TRIGGER') {
          try {
            if (sequence)
              rawData = JSON.stringify({
                ...JSON.parse(rawData),
                executionVersion: 2,
              });
            const parsed = JSON.parse(rawData);
            label =
              parsed?.triggerType === 'story_reply'
                ? 'story_reply'
                : 'comment_on_post';
          } catch {
            label = 'comment_on_post';
          }
        }
        return {
          id: n.id,
          type: backendType,
          label,
          data: rawData,
          positionX: n.position.x,
          positionY: n.position.y,
        };
      });

      const canvasEdges = edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        targetNodeId: e.target,
        sourceHandle: e.sourceHandle || undefined,
      }));

      const res = await fetchApi(`/flows/${id}/canvas`, {
        method: 'PUT',
        body: JSON.stringify({
          nodes: canvasNodes,
          edges: canvasEdges,
          ...(sequence ? { executionVersion: 2 } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toaster.show(
          body.message || t('failed_to_save_flow', 'Falha ao salvar automacao'),
          'warning'
        );
        return;
      }
      await mutate();
      toaster.show(t('flow_saved', 'Automacao salva'), 'success');
    } catch {
      toaster.show(
        t('failed_to_save_flow', 'Falha ao salvar automacao'),
        'warning'
      );
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, id, fetchApi, mutate, t, toaster, sequence]);

  // Sync flow name from API data
  useEffect(() => {
    if (flow?.name) setFlowName(flow.name);
  }, [flow?.name]);

  // Auto-detect view mode: simple flows (linear, no condition) → summary
  useEffect(() => {
    if (viewMode !== null || !flow?.nodes) return;
    const hasCondition = flow.nodes.some((n: any) => n.type === 'CONDITION');
    const nodeCount = flow.nodes.length;
    const isSimple =
      !hasCondition &&
      nodeCount <= 4 &&
      !flow.nodes.some((n: any) => {
        try {
          return JSON.parse(n.data || '{}').executionVersion === 2;
        } catch {
          return false;
        }
      });
    setViewMode(isSimple ? 'summary' : 'advanced');
  }, [flow?.nodes, viewMode]);

  const handleNameSave = useCallback(async () => {
    setEditingName(false);
    const trimmed = flowName.trim();
    if (!trimmed || trimmed === flow?.name) {
      setFlowName(flow?.name || '');
      return;
    }
    try {
      await fetchApi(`/flows/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      await mutate();
    } catch {
      setFlowName(flow?.name || '');
      toaster.show(
        t('failed_to_rename_flow', 'Falha ao renomear automacao'),
        'warning'
      );
    }
  }, [flowName, flow?.name, id, fetchApi, mutate, toaster, t]);

  const handleStatusChange = useCallback(
    async (status: string) => {
      try {
        const res = await fetchApi(`/flows/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toaster.show(
            body.message ||
              t(
                'failed_to_change_status',
                'Falha ao alterar status da automacao'
              ),
            'warning'
          );
          return;
        }
        await mutate();
        toaster.show(
          status === 'ACTIVE'
            ? t('flow_activated', 'Automacao ativada')
            : t('flow_paused', 'Automacao pausada'),
          'success'
        );
      } catch {
        toaster.show(
          t('failed_to_change_status', 'Falha ao alterar status da automacao'),
          'warning'
        );
      }
    },
    [id, fetchApi, mutate, t, toaster]
  );

  if (isLoading) return <LoadingComponent />;
  if (!flow)
    return (
      <div className="p-[24px] text-textColor">
        {t('flow_not_found', 'Flow not found')}
      </div>
    );

  if (viewMode === 'summary') {
    return (
      <div className="flex flex-col h-full flex-1">
        <div className="flex items-center gap-[12px] border-b border-fifth bg-newBgColorInner px-[16px] py-[8px]">
          <button
            onClick={() => router.push('/automacoes')}
            className="text-customColor18 hover:text-textColor"
          >
            &larr;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FlowSummaryComponent
            flow={flow}
            onSwitchToAdvanced={() => setViewMode('advanced')}
            onMutate={() => mutate()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full flex-1">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-fifth bg-newBgColorInner px-[16px] py-[8px]">
        <div className="flex items-center gap-[12px]">
          <button
            onClick={() => router.push('/automacoes')}
            className="text-customColor18 hover:text-textColor"
          >
            &larr;
          </button>
          {editingName ? (
            <input
              autoFocus
              className="text-[14px] font-semibold text-textColor bg-transparent border-b border-textColor outline-none px-[2px]"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSave();
                if (e.key === 'Escape') {
                  setFlowName(flow.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <h2
              className="text-[14px] font-semibold text-textColor cursor-pointer hover:opacity-70"
              onClick={() => setEditingName(true)}
              title={t('click_to_rename', 'Clique para renomear')}
            >
              {flow.name}
            </h2>
          )}
          <span
            className={`rounded-[4px] px-[8px] py-[2px] text-[12px] ${
              flow.status === 'ACTIVE'
                ? 'bg-customColor42/20 text-customColor42'
                : flow.status === 'PAUSED'
                ? 'bg-customColor13/20 text-customColor13'
                : 'bg-btnSimple text-customColor18'
            }`}
          >
            {flow.status === 'ACTIVE'
              ? t('flow_status_active', 'Active')
              : flow.status === 'PAUSED'
              ? t('flow_status_paused', 'Paused')
              : t('flow_status_draft', 'Draft')}
          </span>
        </div>

        <div className="flex items-center gap-[8px]">
          <button
            onClick={() => setViewMode('summary')}
            disabled={sequence}
            className="rounded-[4px] bg-btnSimple border border-fifth px-[12px] py-[6px] text-[12px] text-textColor hover:bg-boxHover"
          >
            {t('view_summary', 'Summary')}
          </button>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="rounded-[4px] bg-btnSimple border border-fifth px-[12px] py-[6px] text-[12px] text-textColor hover:bg-boxHover"
          >
            {showHistory
              ? t('hide_history', 'Ocultar historico')
              : t('show_history', 'Historico')}
          </button>
          {flow.status === 'ACTIVE' ? (
            <button
              onClick={() => handleStatusChange('PAUSED')}
              className="rounded-[4px] bg-customColor13/20 text-customColor13 px-[12px] py-[6px] text-[12px] hover:opacity-80"
            >
              {t('pause_flow', 'Pause')}
            </button>
          ) : (
            <button
              onClick={() => handleStatusChange('ACTIVE')}
              className="rounded-[4px] bg-customColor42/20 text-customColor42 px-[12px] py-[6px] text-[12px] hover:opacity-80"
            >
              {t('activate_flow', 'Activate')}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || (sequence && flow.status === 'ACTIVE')}
            className="rounded-[4px] bg-btnPrimary px-[12px] py-[6px] text-[12px] text-white hover:opacity-80 disabled:opacity-50"
          >
            {saving ? t('saving_flow', 'Saving...') : t('save_flow', 'Save')}
          </button>
        </div>
      </div>

      <div className="border-b border-newTableBorder bg-newBgColorInner px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <label className="flex items-center gap-2 text-sm text-textColor">
            <input
              type="checkbox"
              checked={sequence}
              disabled={
                flow.status === 'ACTIVE' ||
                flow.nodes.some((n: any) => {
                  try {
                    return JSON.parse(n.data || '{}').executionVersion === 2;
                  } catch {
                    return false;
                  }
                })
              }
              onChange={(e) => setSequence(e.target.checked)}
            />
            {t('flow_sequence_enable', 'Separate message sequence')}
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-lg bg-btnSimple px-3 py-2 text-sm text-textColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
            aria-expanded={showPreview}
          >
            {t('flow_preview', 'Message preview')}
          </button>
        </div>
        <p className="text-xs text-tableText" role="note">
          {sequence
            ? t(
                'flow_sequence_rules',
                'One first DM per comment. Wait for a reply before sending more. Media and text are separate messages; subsequent sends must stay within the messaging window.'
              )
            : t(
                'flow_sequence_legacy',
                'Current engine: messages are combined and sent at the end. Enable the new sequence on a paused or draft automation to send each step separately.'
              )}
        </p>
        {flow.status === 'ACTIVE' && (
          <p className="text-xs text-tableText">
            {t(
              'flow_sequence_pause',
              'Pause before enabling or editing a new message sequence. Existing executions keep their original engine.'
            )}
          </p>
        )}
        <input
          type="search"
          aria-label={t('flow_find_step', 'Find a step')}
          placeholder={t('flow_find_step', 'Find a step')}
          value={paletteSearch}
          onChange={(e) => setPaletteSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-newTableBorder bg-newBgColor px-3 py-2 text-sm text-textColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
        <div className="flex gap-2 flex-wrap">
          {NODE_TOOLBAR_CONFIG.filter(
            (item) =>
              !paletteSearch ||
              t(item.labelKey, item.label)
                .toLocaleLowerCase()
                .includes(paletteSearch.toLocaleLowerCase())
          ).map((item) => (
            <button
              type="button"
              key={`${item.type}:${'kind' in item ? item.kind : ''}`}
              draggable
              disabled={
                !sequence && (item.type === 'waitReply' || 'kind' in item)
              }
              onDragStart={(e) =>
                onDragStart(
                  e,
                  `${item.type}${'kind' in item ? ':' + item.kind : ''}`
                )
              }
              onClick={() =>
                handleAddNode(item.type, 'kind' in item ? item.kind : undefined)
              }
              className="flex items-center gap-2 rounded-lg border border-newTableBorder bg-btnSimple px-3 py-2 text-left text-textColor hover:bg-boxHover disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-btnPrimary"
              style={{ borderLeftWidth: 3, borderLeftColor: item.color }}
              title={t('click_or_drag_to_add', 'Click or drag to add')}
            >
              <span>
                <span className="block text-xs font-semibold">
                  {t(item.labelKey, item.label)}
                </span>
                <span className="block text-[11px] text-tableText">
                  {t(item.descKey, item.desc)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <FlowNodeActionsContext.Provider
          value={{
            edit: setSelectedNode,
            disabled: sequence && flow.status === 'ACTIVE',
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            deleteKeyCode={
              sequence && flow.status === 'ACTIVE'
                ? null
                : ['Backspace', 'Delete']
            }
            fitView
            style={{ background: 'var(--new-bgColor)' }}
          >
            <Background color="var(--new-bgLineColor)" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                switch (n.type) {
                  case 'trigger':
                    return '#22c55e';
                  case 'condition':
                    return '#eab308';
                  case 'replyComment':
                    return '#3b82f6';
                  case 'sendDm':
                    return '#a855f7';
                  case 'delay':
                    return '#6b7280';
                  default:
                    return '#999';
                }
              }}
            />
          </ReactFlow>
        </FlowNodeActionsContext.Provider>

        {showPreview && (
          <FlowMessagePreview
            nodes={nodes}
            edges={edges}
            onClose={() => setShowPreview(false)}
          />
        )}

        {showHistory && (
          <div className="absolute inset-0 z-20 bg-newBgColorInner overflow-y-auto">
            <div className="flex items-center justify-between p-[12px] border-b border-fifth">
              <h3 className="text-[14px] font-semibold text-textColor">
                {t('flow_executions', 'Historico de Execucoes')}
              </h3>
              <button
                onClick={() => setShowHistory(false)}
                className="text-customColor18 hover:text-textColor text-[20px]"
              >
                &times;
              </button>
            </div>
            <FlowExecutionsComponent flowId={id} />
          </div>
        )}

        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            flowId={id}
            onUpdate={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
};

export const FlowEditorComponent: FC<FlowEditorProps> = ({ id }) => {
  return (
    <ReactFlowProvider>
      <FlowEditorInner id={id} />
    </ReactFlowProvider>
  );
};
