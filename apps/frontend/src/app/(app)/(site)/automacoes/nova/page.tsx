import { AutomationWizardComponent } from '@gitroom/frontend/components/automations/automation-wizard.component';
import { StoryWizardComponent } from '@gitroom/frontend/components/automations/story-wizard.component';

export default async function NovaAutomacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; accounts?: string; type?: string }>;
}) {
  const query = await searchParams;
  const props = {
    initialName: (query.name || '').slice(0, 200),
    initialIntegrationIds: [
      ...new Set((query.accounts || '').split(',').filter(Boolean)),
    ].slice(0, 20),
  };
  return (
    <div className="bg-newBgColorInner flex-1 flex-col flex h-[calc(100dvh-104px)] overflow-hidden">
      {query.type === 'story' ? (
        <StoryWizardComponent {...props} />
      ) : (
        <AutomationWizardComponent {...props} />
      )}
    </div>
  );
}
