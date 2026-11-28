'use client';

import { useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

function CalendarTour({ close }: { close: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const steps = [
    {
      title: t('calendar_tour_plan_title', 'Plan your week'),
      text: t(
        'calendar_tour_plan_text',
        'Switch between day, week and month, or open the list to find a particular post.'
      ),
      example: [
        [
          '09:00',
          t('calendar_tour_product', 'Product announcement'),
          t('scheduled', 'Scheduled'),
        ],
        [
          '14:30',
          t('calendar_tour_team', 'Meet the team'),
          t('draft', 'Draft'),
        ],
      ],
    },
    {
      title: t('calendar_tour_channels_title', 'Find posts by channel'),
      text: t(
        'calendar_tour_channels_text',
        'Select a channel to filter the calendar. Use All channels to bring the other accounts back into view.'
      ),
      example: [
        [
          'Instagram',
          t('calendar_tour_product', 'Product announcement'),
          t('scheduled', 'Scheduled'),
        ],
        [
          'LinkedIn',
          t('calendar_tour_team', 'Meet the team'),
          t('draft', 'Draft'),
        ],
      ],
    },
    {
      title: t('calendar_tour_drafts_title', 'Review a draft'),
      text: t(
        'calendar_tour_drafts_text',
        'See how text and media are organized in a sample draft.'
      ),
      example: [
        [
          t('draft', 'Draft'),
          t('calendar_tour_team', 'Meet the team'),
          'LinkedIn',
        ],
      ],
    },
  ];
  const step = steps[index];
  const atEnd = index === steps.length - 1;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div aria-live="polite">
        <h3 className="text-lg font-semibold text-newTextColor">
          {step.title}
        </h3>
        <p className="mt-1 text-sm leading-6 text-textItemBlur">{step.text}</p>
      </div>
      <div className="rounded-xl border border-newTableBorder bg-newBgColor px-4 py-3">
        <p className="mb-2 text-xs font-semibold text-textItemBlur">
          {t('calendar_tour_example', 'Example with sample data')}
        </p>
        <ul className="m-0 list-none p-0">
          {step.example.map(([label, caption, status]) => (
            <li
              key={caption}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-newTableBorder py-2 text-sm"
            >
              <span className="text-textItemBlur">{label}</span>
              <span className="flex-1 font-semibold">{caption}</span>
              <span className="text-xs text-textItemBlur">{status}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-newTableBorder pt-3">
        <p
          className="text-sm tabular-nums text-textItemBlur"
          aria-live="polite"
        >
          {index + 1} / {steps.length}
        </p>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex(index - 1)}
              className="min-h-[44px] rounded-lg px-3 text-sm text-textItemBlur hover:bg-boxHover hover:text-newTextColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
            >
              {t('back', 'Back')}
            </button>
          )}
          <button
            type="button"
            onClick={atEnd ? close : () => setIndex(index + 1)}
            className="min-h-[44px] rounded-lg bg-btnPrimary px-4 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-newTextColor"
          >
            {atEnd ? t('calendar_tour_done', 'Done') : t('next', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CalendarTourButton() {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const title = t('calendar_tour', 'Calendar tour');
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-controls="mali-calendar-tour"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
        className="ms-auto flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-textItemBlur hover:bg-boxHover hover:text-newTextColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m10 8 6 4-6 4z" strokeLinejoin="round" />
        </svg>
        {title}
      </button>
      <dialog
        ref={dialog}
        id="mali-calendar-tour"
        aria-labelledby="mali-calendar-tour-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="m-auto max-h-[calc(100dvh-24px)] w-[min(500px,calc(100%_-_24px))] max-w-none rounded-xl border border-newTableBorder bg-newBgColorInner p-0 text-newTextColor shadow-lg backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 border-b border-newTableBorder pb-2">
            <h2 id="mali-calendar-tour-title" className="text-sm font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t('close', 'Close')}
              className="grid h-[44px] w-[44px] place-items-center rounded-lg hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m6 6 12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          {open && <CalendarTour close={close} />}
        </div>
      </dialog>
    </>
  );
}
