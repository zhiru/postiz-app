export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { ReportComponent } from '@gitroom/frontend/components/report/report.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Report`,
  description: '',
};
export default async function Index() {
  return <ReportComponent />;
}
