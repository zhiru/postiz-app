'use client';

import React, {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { jakartaSans } from '@gitroom/frontend/fonts/plus-jakarta-sans/plus.jakarta.sans.font';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { ProfileSelector } from '@gitroom/frontend/components/layout/profile.selector';
import { InvoicesComponent } from '@gitroom/frontend/components/layout/invoices.component';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { NoProfileAssignedComponent } from '@gitroom/frontend/components/layout/no-profile-assigned.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { setSentryUser } from '@gitroom/react/sentry/initialize.sentry.client';
import { setUserTimezone } from '@gitroom/frontend/components/layout/set.timezone';

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();
  const t = useT();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileMenu = useRef<HTMLDialogElement>(null);
  const closeMenu = () => mobileMenu.current?.close();

  useEffect(() => {
    mobileMenu.current?.close();
  }, [pathname]);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 1025px)');
    const closeOnDesktop = () => {
      if (!mobileViewport.matches) mobileMenu.current?.close();
    };
    mobileViewport.addEventListener('change', closeOnDesktop);
    return () => mobileViewport.removeEventListener('change', closeOnDesktop);
  }, []);
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    // set before anything renders a date in the user's timezone
    onSuccess: (data) => setUserTimezone(data?.timezoneName),
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  useEffect(() => {
    setSentryUser(
      user ? { id: user.id, email: user.email, orgId: user.orgId } : null
    );
  }, [user]);

  if (!user) return null;

  // Closed-by-default: org USER sem perfil atribuido nao carrega o app —
  // ve o estado "aguardando atribuicao" ate um admin conceder um perfil.
  if (user.role === 'USER' && !user.profileId) {
    return <NoProfileAssignedComponent />;
  }

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        useSingleEndpoint={true}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen w-full min-w-0 text-newTextColor p-[12px] mobile:p-[8px] mobile:pb-[80px]',
                jakartaSans.className
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex gap-[8px] mobile:gap-0">
                    <Support />
                    <aside className="w-[174px] tablet:w-[166px] shrink-0 rounded-[12px] border border-newTableBorder bg-newBgColorInner mobile:hidden">
                      <div className="sticky top-[12px] flex max-h-[calc(100dvh-24px)] min-h-[calc(100dvh-26px)] flex-col gap-[10px] overflow-y-auto px-[10px] pb-[10px]">
                        <div className="flex border-b border-newTableBorder ps-[10px]">
                          <Logo />
                        </div>
                        <TopMenu />
                      </div>
                    </aside>
                    <dialog
                      ref={mobileMenu}
                      id="mali-mobile-navigation"
                      aria-labelledby="mali-mobile-navigation-title"
                      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 text-newTextColor backdrop:bg-black/55"
                      onClose={() => setMenuOpen(false)}
                      onClick={(event) => {
                        if (event.target === event.currentTarget) closeMenu();
                      }}
                    >
                      <div className="flex h-full w-[min(272px,calc(100vw-44px))] flex-col overflow-y-auto border-e border-newTableBorder bg-newBgColorInner px-[12px] pb-[12px]">
                        <div className="mb-[10px] flex h-[64px] shrink-0 items-center justify-between border-b border-newTableBorder ps-[8px]">
                          <h2
                            id="mali-mobile-navigation-title"
                            className="text-[15px] font-semibold"
                          >
                            {t('navigation', 'Navigation')}
                          </h2>
                          <button
                            type="button"
                            onClick={closeMenu}
                            aria-label={t('close', 'Close')}
                            className="grid h-[44px] w-[44px] place-items-center rounded-[8px] hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary"
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
                        {menuOpen && <TopMenu onNavigate={closeMenu} />}
                      </div>
                    </dialog>
                    <div className="flex-1 min-w-0 bg-newBgLineColor rounded-[12px] border border-newTableBorder overflow-hidden flex flex-col gap-[1px] blurMe">
                      {/* relative: the notifications popup spans this bar on phones */}
                      <div className="relative flex bg-newBgColorInner h-[60px] shrink-0 px-[18px] mobile:px-[10px] gap-[10px] items-center">
                        <button
                          type="button"
                          className="hidden mobile:flex shrink-0 items-center justify-center w-[44px] h-[44px] -ms-[6px] rounded-[8px] text-textItemBlur hover:text-newTextColor hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary"
                          onClick={() => {
                            mobileMenu.current?.showModal();
                            setMenuOpen(true);
                          }}
                          aria-label={t('open_menu', 'Open menu')}
                          aria-expanded={menuOpen}
                          aria-controls="mali-mobile-navigation"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M3 6H21M3 12H21M3 18H21"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        <div className="text-[19px] mobile:text-[16px] font-[650] flex flex-1 min-w-0">
                          <Title />
                        </div>
                        <div className="flex items-center gap-[14px] mobile:gap-[8px] text-textItemBlur">
                          <StreakComponent />
                          <OrganizationSelector />
                          <ProfileSelector />
                          <InvoicesComponent />
                          <div className="hover:text-newTextColor">
                            <ModeComponent />
                          </div>
                          <LanguageComponent />
                          <div className="contents mobile:hidden">
                            <ChromeExtensionComponent />
                          </div>
                          <div className="contents mobile:hidden">
                            <AttachToFeedbackIcon />
                          </div>
                          <NotificationComponent />
                        </div>
                      </div>
                      <div className="flex flex-1 min-w-0 gap-[1px] mobile:flex-col">
                        {children}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
