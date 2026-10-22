import React, { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModalWrapperComponent } from '@gitroom/frontend/components/new-launch/modal.wrapper.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const PreConditionComponentModal: FC = () => {
  const modal = useModals();
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="whitespace-pre-line">
        {t(
          'previous_account_trial_notice',
          "This social channel was previously connected to another Postiz account.\nTo connect it during your trial, you can end the trial now: your plan's first payment is charged today instead of at the end of the trial, and nothing extra is added.\n\nThis payment is final and not refundable."
        )}
      </div>
      <div className="flex gap-[2px] justify-center">
        <Button
          onClick={() => (window.location.href = '/billing?finishTrial=true')}
        >
          {t('fast_track_charge_now', 'End trial and pay now')}
        </Button>
        <Button onClick={modal.closeCurrent} secondary={true}>
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};
export const PreConditionComponent: FC = () => {
  const modal = useModals();
  const query = useSearchParams();
  const t = useT();
  useEffect(() => {
    if (query.get('precondition')) {
      modal.openModal({
        title: t(
          'suspicious_activity_detected',
          'Suspicious activity detected'
        ),
        withCloseButton: true,
        classNames: {
          modal: 'text-textColor',
        },
        children: <PreConditionComponentModal />,
      });
    }
  }, []);
  return null;
};
