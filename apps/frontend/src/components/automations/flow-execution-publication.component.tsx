'use client';

import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFlowExecutionPublication } from './hooks/use-flows';

export const FlowExecutionPublication = ({
  flowId,
  executionId,
}: {
  flowId: string;
  executionId: string;
}) => {
  const t = useT();
  const { data, isLoading } = useFlowExecutionPublication(flowId, executionId);
  const label = t('flow_open_publication', 'Open publication in a new tab');
  const className =
    'inline-flex rounded-[4px] border border-[var(--new-border)] bg-[var(--new-btn-simple)] px-[12px] py-[8px] text-[12px] text-textColor focus-visible:ring-2 focus-visible:ring-[var(--new-btn-primary)]';

  return (
    <div className="mb-[16px]">
      {data?.permalink ? (
        <a
          href={data.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
        >
          {label}
        </a>
      ) : (
        <>
          <button
            type="button"
            disabled
            className={`${className} opacity-50`}
            aria-describedby="execution-publication-status"
          >
            {label}
          </button>
          <p
            id="execution-publication-status"
            role="status"
            className="mt-[4px] text-[12px] text-[var(--new-textItemBlur)]"
          >
            {isLoading
              ? t('flow_publication_loading', 'Loading publication link...')
              : t(
                  'flow_publication_unavailable',
                  'Publication link unavailable'
                )}
          </p>
        </>
      )}
    </div>
  );
};
