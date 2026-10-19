import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Organization, Profile } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import { GetReportDto } from '@gitroom/nestjs-libraries/dtos/analytics/get.report.dto';
import { BackfillReportDto } from '@gitroom/nestjs-libraries/dtos/analytics/backfill.report.dto';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _analyticsReportService: AnalyticsReportService
  ) {}

  @Get('/report')
  async getReport(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Query() query: GetReportDto,
    @Res({ passthrough: true }) res: Response
  ) {
    if (query.format !== 'csv') {
      return this._analyticsReportService.getReport(org.id, query, profile?.id);
    }

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header(
      'Content-Disposition',
      `attachment; filename="postiz-report-${query.from}-${query.to}.csv"`
    );

    return this._analyticsReportService.getReportCsv(org.id, query, profile?.id);
  }

  @Post('/report/backfill')
  async backfillReport(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Query() query: BackfillReportDto
  ) {
    return this._analyticsReportService.backfill(
      org,
      query.integration,
      query.days,
      profile?.id
    );
  }

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date, false, profile?.id);
  }

  @Get('/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    return this._postsService.checkPostAnalytics(org.id, postId, +date, false, profile?.id);
  }
}
