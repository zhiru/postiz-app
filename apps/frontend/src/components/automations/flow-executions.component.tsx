'use client';

import { FC, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useFlowRedispatch } from './hooks/use-flow-redispatch';
import { useFlowHistory } from './hooks/use-flow-history';
import { FlowExecutionList } from './flow-execution-list.component';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFlowExecution } from '@gitroom/frontend/components/automations/hooks/use-flows';

interface FlowExecutionsProps {
  flowId: string;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  TRIGGER: 'Trigger',
  CONDITION: 'Condition',
  REPLY_COMMENT: 'Reply Comment',
  SEND_DM: 'Send DM',
  DELAY: 'Delay',
  GATE_RESOLVE: 'Gate de Follow',
};

const NODE_TYPE_COLORS: Record<string, string> = {
  TRIGGER: '#22c55e',
  CONDITION: '#eab308',
  REPLY_COMMENT: '#3b82f6',
  SEND_DM: '#a855f7',
  DELAY: '#f97316',
  GATE_RESOLVE: '#eab308',
};

const RedispatchExecution: FC<{ flowId: string; executionId: string; onStarted: () => Promise<unknown> }> = ({ flowId, executionId, onStarted }) => {
  const t = useT();
  const fetch = useFetch();
  const [review, setReview] = useState(false);
  const [result, setResult] = useState<'sending' | 'started' | 'blocked' | null>(null);
  const inFlight = useRef(false);
  const { data: preview, error, isLoading } = useFlowRedispatch(flowId, executionId, review);
  const send = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true;
    setResult('sending');
    try {
      const response = await fetch(`/flows/${flowId}/executions/${executionId}/redispatch`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, configurationToken: preview.configurationToken }),
      });
      if (!response.ok) throw new Error('Redispatch blocked');
      setResult('started');
      await onStarted();
    } catch {
      // A lost response can follow a successful start. Require a fresh history read.
      setResult('blocked');
    }
  };
  const buttonClass = 'rounded px-3 py-2 border border-[var(--new-border)] text-[12px] disabled:opacity-50 focus-visible:ring-2';
  return <div className="mb-4 text-[12px]">
    {!review && <button className={buttonClass} onClick={() => setReview(true)}>{t('flow_redispatch', 'Redispatch')}</button>}
    {review && <div className="rounded border border-[var(--new-border)] p-3" aria-live="polite">
      {isLoading && <p role="status">{t('flow_redispatch_checking', 'Checking current rules and previous execution...')}</p>}
      {(error || result === 'blocked') && <p role="alert">{t('flow_redispatch_blocked', 'Redispatch blocked or result unknown. Reload and check execution and delivery history before taking any manual action.')}</p>}
      {preview && !error && !result && <>
        <p>{t('flow_redispatch_confirmation', 'Redispatch this comment using the current rules? Matching keywords, exclusions and follow requirements still apply. This can send real messages:')}</p>
        <ul className="my-2 list-disc pl-5">
          <li>{preview.publicReply ? t('flow_redispatch_public_yes', 'Public reply: may be sent to the comment.') : t('flow_redispatch_public_no', 'Public reply: none configured.')}</li>
          <li>{preview.directMessage ? t('flow_redispatch_dm_yes', 'DM: may be sent privately to the commenter, including the follow gate.') : t('flow_redispatch_dm_no', 'DM: none configured.')}</li>
        </ul>
        <button className={buttonClass} onClick={send}>{t('flow_redispatch_confirm', 'Confirm redispatch')}</button>
      </>}
      {result === 'sending' && <p role="status">{t('flow_redispatch_sending', 'Requesting redispatch...')}</p>}
      {result === 'started' && <p role="status">{t('flow_redispatch_started', 'Redispatch requested. Follow the execution history for the result.')}</p>}
      {!result && <button className={`${buttonClass} ml-2`} onClick={() => setReview(false)}>{t('cancel', 'Cancel')}</button>}
    </div>}
  </div>;
};

const ExecutionDetail: FC<{
  flowId: string;
  executionId: string;
  onBack: () => void;
}> = ({ flowId, executionId, onBack }) => {
  const t = useT();
  const { data: execution, isLoading, mutate } = useFlowExecution(flowId, executionId);

  const backToList = (
    <button
      onClick={onBack}
      className="text-[12px] text-customColor18 hover:text-textColor mb-[12px]"
    >
      &larr; {t('back_to_list', 'Back to list')}
    </button>
  );

  if (isLoading) {
    return (
      <div className="text-[14px] text-customColor18 p-[16px]">
        {backToList}
        <p>{t('loading_executions', 'Loading...')}</p>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="text-[14px] text-customColor18 p-[16px]">
        {backToList}
        <p>{t('execution_not_found', 'Execution not found')}</p>
      </div>
    );
  }

  const log: Array<{
    nodeId: string;
    nodeType: string;
    status: string;
    timestamp: string;
    error?: string;
  }> = (() => {
    try {
      const parsed = JSON.parse(execution.executionLog || '[]');
      return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === 'object') : [];
    } catch { return []; }
  })();
  const canRedispatch = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status) &&
    (!execution.triggerType || execution.triggerType === 'comment_on_post') &&
    log.some((entry) => entry.nodeType === 'TRIGGER' && entry.status === 'skipped' && entry.error === 'keywords_not_matched') &&
    !log.some((entry) => entry.status === 'redispatch_requested');

  return (
    <div className="p-[16px]">
      {backToList}

      <div className="flex items-center gap-[8px] mb-[12px]">
        <span className="text-[13px] font-semibold text-textColor">
          {execution.igCommenterName || execution.igCommenterId}
        </span>
        <span
          className={`rounded-[4px] px-[8px] py-[2px] text-[10px] ${
            execution.status === 'COMPLETED'
              ? 'bg-customColor42/20 text-customColor42'
              : execution.status === 'FAILED'
              ? 'bg-customColor19/20 text-customColor19'
              : execution.status === 'WAITING_POSTBACK'
              ? 'bg-yellow-500/20 text-yellow-500'
              : 'bg-customColor51/20 text-customColor51'
          }`}
        >
          {String(
            t(
              `flow_execution_status_${execution.status.toLowerCase()}`,
              execution.status
            )
          )}
        </span>
      </div>

      <p className="text-[12px] text-customColor18 mb-[16px]">
        &ldquo;{execution.commentText}&rdquo;
      </p>

      {execution.error && (
        <div className="rounded-[4px] border border-customColor19/40 bg-customColor19/10 p-[12px] mb-[16px]">
          <p className="text-[12px] text-customColor19">{execution.error}</p>
        </div>
      )}

      {canRedispatch && <RedispatchExecution key={executionId} flowId={flowId} executionId={executionId} onStarted={() => mutate()} />}

      {/* Timeline */}
      {log.length > 0 ? (
        <div className="relative pl-[24px]">
          <div className="absolute left-[8px] top-[4px] bottom-[4px] w-[2px] bg-fifth" />
          {log.map((entry, i) => {
            const color = NODE_TYPE_COLORS[entry.nodeType] || '#6b7280';
            const isError =
              entry.status === 'error' || entry.status === 'gate_exhausted';
            const isSkipped =
              entry.status === 'skipped' || entry.status === 'gate_blocked';
            const isCompleted =
              entry.status === 'completed' || entry.status === 'gate_passed';
            const isWaiting = entry.status === 'awaiting_postback';
            return (
              <div key={i} className="relative mb-[16px] last:mb-0">
                <div
                  className="absolute left-[-20px] top-[2px] w-[12px] h-[12px] rounded-full border-2"
                  style={{
                    borderColor: color,
                    backgroundColor: isError
                      ? '#ef4444'
                      : isSkipped
                      ? '#6b7280'
                      : isWaiting
                      ? '#eab308'
                      : isCompleted
                      ? color
                      : 'transparent',
                  }}
                />
                <div>
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[12px] font-medium text-textColor">
                      {t(
                        `flow_node_type_${entry.nodeType.toLowerCase()}`,
                        NODE_TYPE_LABELS[entry.nodeType] || entry.nodeType
                      )}
                    </span>
                    <span
                      className={`text-[10px] px-[6px] py-[1px] rounded-[3px] ${
                        isError
                          ? 'bg-customColor19/20 text-customColor19'
                          : isSkipped
                          ? 'bg-btnSimple text-customColor18'
                          : isWaiting
                          ? 'bg-yellow-500/20 text-yellow-500'
                          : entry.status === 'entered'
                          ? 'bg-customColor51/20 text-customColor51'
                          : 'bg-customColor42/20 text-customColor42'
                      }`}
                    >
                      {t(`flow_log_status_${entry.status}`, entry.status)}
                    </span>
                  </div>
                  <span className="text-[10px] text-customColor18">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  {entry.error && entry.status !== 'completed' && entry.status !== 'redispatch_requested' && (
                    <p className="text-[10px] text-customColor19 mt-[2px]">
                      {entry.error}
                    </p>
                  )}
                  {entry.error &&
                    entry.status === 'completed' &&
                    entry.error.startsWith('branch:') && (
                      <p className="text-[10px] text-customColor18 mt-[2px]">
                        {t('branch_taken', 'Branch')}:{' '}
                        {entry.error.replace('branch:', '')}
                      </p>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[12px] text-customColor18">
          {t('no_execution_log', 'No detailed log available')}
        </p>
      )}
    </div>
  );
};

export const FlowExecutionsComponent: FC<FlowExecutionsProps> = ({
  flowId,
}) => {
  const { selectedExecutionId, historyHref, navigateHistory } =
    useFlowHistory();

  if (selectedExecutionId) {
    return (
      <ExecutionDetail
        flowId={flowId}
        executionId={selectedExecutionId}
        onBack={() => navigateHistory(true)}
      />
    );
  }

  return (
    <FlowExecutionList
      flowId={flowId}
      onSelect={(executionId) => navigateHistory(true, executionId)}
      executionHref={(executionId) => historyHref(true, executionId)}
    />
  );
};
