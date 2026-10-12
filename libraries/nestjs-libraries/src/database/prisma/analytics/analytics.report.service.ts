import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { AnalyticsReportRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.repository';
import {
  buildReport,
  previousPeriod,
  Report,
  reportToCsv,
  toReportPoints,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/report.aggregate';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { GetReportDto } from '@gitroom/nestjs-libraries/dtos/analytics/get.report.dto';

// The daily job asks every provider for a single day, which is the only window
// where a provider that answers with one aggregated value is still telling us
// about one day.
const DAILY_WINDOW = 1;
const DEFAULT_BACKFILL_DAYS = 30;

@Injectable()
export class AnalyticsReportService {
  constructor(
    private _analyticsReportRepository: AnalyticsReportRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}

  async getReport(
    organizationId: string,
    { from, to, integrations }: GetReportDto
  ): Promise<Report> {
    const channels = await this._analyticsReportRepository.getChannels(
      organizationId,
      integrations
    );
    const ids = channels.map((channel) => channel.id);
    const { previousFrom, previousTo } = previousPeriod(from, to);

    const [points, published, previousPoints, previousPublished] =
      await Promise.all([
        this._analyticsReportRepository.getPoints(organizationId, ids, from, to),
        this._analyticsReportRepository.getPublishedPosts(
          organizationId,
          ids,
          from,
          to
        ),
        this._analyticsReportRepository.getPoints(
          organizationId,
          ids,
          previousFrom,
          previousTo
        ),
        this._analyticsReportRepository.getPublishedPosts(
          organizationId,
          ids,
          previousFrom,
          previousTo
        ),
      ]);

    return buildReport({
      from,
      to,
      channels,
      points: [...points, ...published],
      previousPoints: [...previousPoints, ...previousPublished],
    });
  }

  async getReportCsv(organizationId: string, query: GetReportDto) {
    return reportToCsv(await this.getReport(organizationId, query));
  }

  // Walks every connected social channel once a day. One channel failing must
  // not stop the rest, so failures are logged and skipped - the next run picks
  // the day up again, and the upsert makes a repeated run harmless.
  async collectDaily() {
    const integrations =
      await this._analyticsReportRepository.getCollectableIntegrations();

    let collected = 0;
    for (const integration of integrations) {
      try {
        collected += await this.collect(
          integration.organization,
          integration.id,
          integration.providerIdentifier,
          DAILY_WINDOW
        );
      } catch (err) {
        console.warn('Analytics collection failed for a channel', {
          integrationId: integration.id,
          provider: integration.providerIdentifier,
          err,
        });
      }
    }

    return { channels: integrations.length, points: collected };
  }

  async backfill(
    organization: Organization,
    integrationId: string,
    days = DEFAULT_BACKFILL_DAYS
  ) {
    const integration = await this._integrationService.getIntegrationById(
      organization.id,
      integrationId
    );

    if (!integration) {
      throw new Error('Invalid integration');
    }

    return {
      points: await this.collect(
        organization,
        integration.id,
        integration.providerIdentifier,
        days
      ),
    };
  }

  private async collect(
    organization: Organization,
    integrationId: string,
    providerIdentifier: string,
    days: number
  ) {
    const provider =
      this._integrationManager.getSocialIntegration(providerIdentifier);

    if (!provider?.reportMetrics || !provider?.analytics) {
      return 0;
    }

    // checkAnalytics is reused on purpose: it refreshes an expired token and
    // caches the provider answer, which the report would otherwise pay for twice.
    const analytics = await this._integrationService.checkAnalytics(
      organization,
      integrationId,
      String(days)
    );

    return this._analyticsReportRepository.savePoints(
      organization.id,
      toReportPoints(integrationId, analytics, provider.reportMetrics, {
        allowSinglePoint: days <= DAILY_WINDOW,
      })
    );
  }
}
