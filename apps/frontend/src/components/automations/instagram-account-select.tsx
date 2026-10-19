'use client';
import { useId, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type Account = {
  id: string;
  name?: string;
  display?: string;
  profile?: string;
  picture?: string;
};
export const InstagramAccountSelect = ({
  accounts,
  value,
  onChange,
  multiple = true,
  disabled = false,
}: {
  accounts: Account[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
}) => {
  const t = useT();
  const id = useId();
  const [search, setSearch] = useState('');
  const selected = accounts.filter((account) => value.includes(account.id));
  const filtered = accounts.filter((account) =>
    `${account.name || ''} ${account.profile || ''} ${account.display || ''}`
      .toLocaleLowerCase()
      .includes(search.trim().replace(/^@/, '').toLocaleLowerCase())
  );
  return (
    <div className="text-newTextColor space-y-[8px]">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-[6px]" aria-live="polite">
          {selected.map((account) => (
            <span
              key={account.id}
              className="inline-flex items-center gap-[6px] rounded-[6px] bg-btnSimple px-[8px] py-[6px] text-[12px] max-w-full"
            >
              {account.picture && (
                <img
                  src={account.picture}
                  alt=""
                  className="w-[24px] h-[24px] rounded-full object-cover"
                />
              )}
              <span className="break-words">
                {account.name || account.display}
                {account.profile || account.display
                  ? ` (@${(account.profile || account.display)!.replace(
                      /^@/,
                      ''
                    )})`
                  : ''}
              </span>
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <details className="rounded-[8px] border border-newTableBorder bg-newBgColorInner">
          <summary className="cursor-pointer p-[12px] text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary">
            {t('choose_instagram_accounts', 'Choose Instagram accounts')}{' '}
            {value.length ? `(${value.length})` : ''}
          </summary>
          <div className="p-[12px] pt-0 space-y-[8px]">
            <label htmlFor={id} className="sr-only">
              {t('search_instagram_accounts', 'Search by name or username')}
            </label>
            <input
              id={id}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(
                'search_instagram_accounts',
                'Search by name or username'
              )}
              className="w-full bg-newBgColor text-newTextColor border border-newTableBorder rounded-[6px] px-[10px] py-[8px]"
            />
            <div
              className="max-h-[240px] overflow-y-auto space-y-[4px]"
              role="group"
              aria-label={t('instagram_accounts', 'Instagram accounts')}
            >
              {filtered.map((account) => (
                <label
                  key={account.id}
                  className="flex items-center gap-[10px] cursor-pointer rounded-[6px] p-[8px] hover:bg-boxHover"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(account.id)}
                    disabled={
                      multiple &&
                      value.length >= 20 &&
                      !value.includes(account.id)
                    }
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? multiple
                            ? [...value, account.id]
                            : [account.id]
                          : value.filter((current) => current !== account.id)
                      )
                    }
                  />
                  {account.picture && (
                    <img
                      src={account.picture}
                      alt=""
                      className="w-[32px] h-[32px] rounded-full object-cover"
                    />
                  )}
                  <span className="min-w-0 text-[13px] break-words">
                    <span className="block font-semibold">
                      {account.name || account.display || account.id}
                    </span>
                    {(account.profile || account.display) && (
                      <span className="block text-textItemBlur">
                        @
                        {(account.profile || account.display)!.replace(
                          /^@/,
                          ''
                        )}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {!filtered.length && (
                <p className="text-[13px] text-textItemBlur">
                  {t('no_accounts_found', 'No accounts found')}
                </p>
              )}
            </div>
          </div>
        </details>
      )}
      {multiple && value.length > 1 && (
        <p className="text-[12px] text-textItemBlur">
          {t(
            'multiple_automations_help',
            'The same settings create one automation per account. History and activation are managed separately. For specific posts, configure each account separately.'
          )}
        </p>
      )}
    </div>
  );
};
