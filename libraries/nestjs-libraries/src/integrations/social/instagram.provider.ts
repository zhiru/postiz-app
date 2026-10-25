import { HttpException } from '@nestjs/common';
import { ssrfSafeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { CommentAutomationDeliveryError } from './social.integrations.interface';
import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
  ReportMetricsMap,
  PendingCheckResponse,
  SocialCommentDetails,
  PublishedPostsPage,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';
import {
  RefreshToken,
  SocialAbstract,
  BadBody,
  Disconnect,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { Integration } from '@prisma/client';
import {
  META_FACEBOOK_GRAPH_URL,
  META_FACEBOOK_OAUTH_URL,
  metaGraphUrl,
} from '@gitroom/nestjs-libraries/integrations/social/meta-graph.constants';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { InstagramDmButton } from '@gitroom/nestjs-libraries/integrations/social/instagram-dm-button.type';
import { withTrend } from '@gitroom/nestjs-libraries/integrations/social/analytics.trend';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  graphFetch,
  graphPaginate,
} from '@gitroom/nestjs-libraries/integrations/social/meta.graph';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

async function fetchWithTimeout(
  url: string,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await ssrfSafeFetch(url, {
      signal: controller.signal,
      redirect: 'error',
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildButton(button: InstagramDmButton) {
  if (button.kind === 'postback') {
    return {
      type: 'postback',
      title: button.title.slice(0, 20),
      payload: button.payload,
    };
  }
  return {
    type: 'web_url',
    url: button.url,
    title: button.title.slice(0, 20),
  };
}

export const instagramReportMetrics: ReportMetricsMap = {
  followersGained: ['Follower Count'],
  reach: ['Reach'],
  engagement: ['Likes', 'Comments', 'Shares', 'Saves', 'Replies'],
};

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram';

  name = 'Instagram\n(Facebook Business)';

  isBetweenSteps = true;

  noNativeRefresh = true;

  toolTip = 'Instagram must be business and connected to a Facebook page';

  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
    'instagram_manage_messages',
  ];

  async checkRemoteDeletion(
    accountId: string,
    accessToken: string,
    mediaId: string
  ) {
    const userToken = accessToken.split('___')[1];
    if (!userToken)
      throw new HttpException(
        {
          code: 'FACEBOOK_USER_TOKEN_REQUIRED',
          message: 'Reconnect Instagram using Facebook Login to delete media.',
        },
        412
      );
    const read = async (path: string) => {
      const response = await ssrfSafeFetch(
        `${META_FACEBOOK_GRAPH_URL}/${path}`,
        {
          headers: { Authorization: `Bearer ${userToken}` },
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
        }
      );
      if (!response.ok)
        throw new HttpException(
          {
            code: 'INSTAGRAM_DELETE_ACCESS_REQUIRED',
            message:
              'Verify Facebook Login and instagram_manage_contents permission before deleting.',
          },
          412
        );
      return response.json();
    };
    const permissions = await read('me/permissions');
    if (
      !permissions.data?.some(
        (entry: any) =>
          entry.permission === 'instagram_manage_contents' &&
          entry.status === 'granted'
      )
    )
      throw new HttpException(
        {
          code: 'INSTAGRAM_DELETE_PERMISSION_REQUIRED',
          message:
            'Grant instagram_manage_contents and reconnect Instagram using Facebook Login.',
        },
        412
      );
    const media = await read(`${encodeURIComponent(mediaId)}?fields=id,owner`);
    if (
      media.id !== mediaId ||
      String(media.owner?.id ?? media.owner) !== accountId
    )
      throw new HttpException(
        {
          code: 'INSTAGRAM_MEDIA_OWNER_MISMATCH',
          message:
            'This media does not belong to the connected Instagram account.',
        },
        409
      );
  }

  async deletePublishedPost(
    accessToken: string,
    mediaId: string
  ): Promise<{ success: true; deletedId: string }> {
    const userToken = accessToken.split('___')[1];
    if (!userToken) throw new Error('Facebook user token required');
    // Never retry a destructive request after a timeout or uncertain response.
    const response = await ssrfSafeFetch(
      `${META_FACEBOOK_GRAPH_URL}/${encodeURIComponent(mediaId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` },
        signal: AbortSignal.timeout(25000),
        redirect: 'error',
      }
    );
    const result = await response.json();
    if (
      !response.ok ||
      result.success !== true ||
      String(result.deleted_id) !== mediaId
    )
      throw new Error('Remote deletion was not confirmed');
    return { success: true, deletedId: mediaId };
  }

  override maxConcurrentJob = 400;

  editor = 'normal' as const;

  dto = InstagramDto;

  maxLength() {
    return 2200;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('An unknown error occurred') > -1) {
      return {
        type: 'retry' as const,
        value: 'An unknown error occurred, please try again later',
      };
    }
    if (body.indexOf('2207081') > -1) {
      return {
        type: 'bad-body' as const,
        value: "This account doesn't support Trial Reels",
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'Something is wrong with your connected user, please re-authenticate',
      };
    }

    if (
      body.toLowerCase().indexOf('the user is not an instagram business') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Your Instagram account is not a business account, please convert it to a business account',
      };
    }

    if (body.toLowerCase().indexOf('session has been invalidated') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again',
      };
    }

    if (body.indexOf('2207050') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram user is restricted',
      };
    }

    // Media download/upload errors
    if (body.indexOf('2207003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Timeout downloading media, please try again',
      };
    }

    if (body.indexOf('2207020') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media expired, please upload again',
      };
    }

    if (body.indexOf('2207032') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to create media, please try again',
      };
    }

    if (body.indexOf('2207053') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown upload error, please try again',
      };
    }

    if (body.indexOf('2207052') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media fetch failed, please try again',
      };
    }

    if (body.indexOf('2207057') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid thumbnail offset for video',
      };
    }

    if (body.indexOf('2207026') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported video format',
      };
    }

    if (body.indexOf('2207023') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown media type',
      };
    }

    if (body.indexOf('2207006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media not found, please upload again',
      };
    }

    if (body.indexOf('2207008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media builder expired, please try again',
      };
    }

    // Content validation errors
    if (body.indexOf('2207028') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Carousel validation failed',
      };
    }

    if (body.indexOf('2207010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Caption is too long',
      };
    }

    // Product tagging errors
    if (body.indexOf('2207035') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions not supported for videos',
      };
    }

    if (body.indexOf('2207036') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions required for photos',
      };
    }

    if (body.indexOf('2207037') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag validation failed',
      };
    }

    if (body.indexOf('2207040') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Too many product tags',
      };
    }

    // Image format/size errors
    if (body.indexOf('2207004') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Image is too large',
      };
    }

    if (body.indexOf('2207005') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported image format',
      };
    }

    if (body.indexOf('2207009') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('Page request limit reached') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Page posting for today is limited, please try again tomorrow',
      };
    }

    if (body.indexOf('2207042') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have reached the maximum of 25 posts per day, allowed for your account',
      };
    }

    if (body.indexOf('Not enough permissions to post') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Not enough permissions to post',
      };
    }

    if (body.indexOf('36003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    const isInvalidMetaUserSession =
      /(?:"code"\s*:\s*190|\b190\b)/.test(body) &&
      /(?:"error_subcode"\s*:\s*(?:460|464)|\b190\s*\/\s*(?:460|464)\b)/.test(
        body
      );
    if (isInvalidMetaUserSession) {
      return {
        type: 'refresh-token' as const,
        value:
          'The connected Facebook user session is no longer valid, please reconnect the account',
      };
    }

    if (body.indexOf('190,') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'The account is missing some permissions to perform this action, please re-add the account and allow all permissions',
      };
    }

    if (body.indexOf('36001') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid Instagram image resolution max: 1920x1080px',
      };
    }

    if (body.indexOf('2207051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram blocked your request',
      };
    }

    if (body.indexOf('2207001') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram detected that your post is spam, please try again with different content',
      };
    }

    if (body.indexOf('2207027') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown error, please try again later or contact support',
      };
    }

    if (body.indexOf('param collaborators is not allowed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Collaborators are not allowed for carousel',
      };
    }

    return undefined;
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const findPage = (await this.discoverPages(accessToken, requiredId)).find(
      (p) => p.id === requiredId
    );

    if (!findPage) {
      throw new Error(
        'Instagram account is not available in this authorization'
      );
    }
    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      pageId: findPage.pageId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const clientId =
      clientInformation?.client_id || process.env.FACEBOOK_APP_ID;
    const state = makeSecureId(6);
    return {
      url:
        `${META_FACEBOOK_OAUTH_URL}/dialog/oauth` +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/instagram`
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(
          [...this.scopes, 'instagram_manage_contents'].join(',')
        )}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh: string;
    },
    clientInformation?: ClientInformation
  ) {
    const clientId =
      clientInformation?.client_id || process.env.FACEBOOK_APP_ID;
    const clientSecret =
      clientInformation?.client_secret || process.env.FACEBOOK_APP_SECRET;

    // Log de quais credenciais estao sendo usadas (sem expor secret).
    // Ajuda a diagnosticar falhas de token-exchange por client_id divergente
    // entre Settings > Credentials (DB) e o App registrado no Meta.
    console.log('[Instagram.authenticate] credentials source:', {
      hasClientInfo: !!clientInformation,
      clientIdPrefix: String(clientId || '').slice(0, 6) + '...',
      hasSecret: !!clientSecret,
      redirectUri: `${process.env.FRONTEND_URL}/integrations/social/instagram${
        params.refresh ? `?refresh=${params.refresh}` : ''
      }`,
    });

    const getAccessToken = await (
      await fetchWithTimeout(
        `${META_FACEBOOK_GRAPH_URL}/oauth/access_token` +
          `?client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/instagram${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${clientSecret}` +
          `&code=${params.code}`
      )
    ).json();

    // Loga a resposta crua do token-exchange. Se vier {error: {...}}, conseguimos
    // ver o motivo exato (rate limit, code expirado, redirect_uri mismatch).
    if (!getAccessToken.access_token) {
      throw new Error('Meta token exchange failed');
    }

    const longLivedResponse = await (
      await fetchWithTimeout(
        `${META_FACEBOOK_GRAPH_URL}/oauth/access_token` +
          '?grant_type=fb_exchange_token' +
          `&client_id=${clientId}` +
          `&client_secret=${clientSecret}` +
          `&fb_exchange_token=${getAccessToken.access_token}`
      )
    ).json();

    if (!longLivedResponse.access_token) {
      throw new Error('Meta long-lived token exchange failed');
    }
    const { access_token, expires_in, ...all } = longLivedResponse;

    const permsResponse = await (
      await fetchWithTimeout(
        `${META_FACEBOOK_GRAPH_URL}/me/permissions?access_token=${access_token}`
      )
    ).json();

    if (!permsResponse.data) {
      throw new Error(
        `Meta /me/permissions failed: ${JSON.stringify(
          permsResponse.error || permsResponse
        )}`
      );
    }
    const { data } = permsResponse;

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetchWithTimeout(
        `${META_FACEBOOK_GRAPH_URL}/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  reusableAccountAuthorization = true;

  async pages(accessToken: string) {
    return this.discoverPages(accessToken);
  }

  private async discoverPages(accessToken: string, requiredId?: string) {
    let throttled = false;
    let authorizationExpired = false;
    const seenPageIds = new Set<string>();
    const allFacebookPages: any[] = [];
    // Request account metadata with its Page instead of one extra read per Instagram.
    const fields =
      'id,instagram_business_account{id,name,username,profile_picture_url}';
    const overallDeadline = Date.now() + 90000;
    const budgetExceeded = () => Date.now() >= overallDeadline;
    const hasRequiredAccount = () =>
      !!requiredId &&
      allFacebookPages.some(
        (page) => page.instagram_business_account?.id === requiredId
      );
    const shouldStop = () =>
      throttled ||
      authorizationExpired ||
      budgetExceeded() ||
      hasRequiredAccount();

    const rateLimitError = () => {
      throttled = true;
      return new HttpException(
        {
          code: 'PROVIDER_RATE_LIMIT',
          message:
            'The provider is temporarily limiting requests. Wait a few minutes and reconnect the channel.',
        },
        429
      );
    };
    const read = async (url: string) => {
      const remaining = overallDeadline - Date.now();
      if (remaining <= 0)
        throw new Error('Instagram discovery time budget exceeded');
      const response = await ssrfSafeFetch(url, {
        signal: AbortSignal.timeout(Math.min(15000, remaining)),
        redirect: 'error',
      });
      if (response.status === 429) throw rateLimitError();
      const body = await response.json();
      if ([4, 17, 32, 613, 80001, 80002, 80004].includes(body?.error?.code)) {
        throw rateLimitError();
      }
      if (body?.error?.code === 190) {
        authorizationExpired = true;
        throw new HttpException({ code: 'AUTHORIZATION_EXPIRED' }, 412);
      }
      return body;
    };
    const fetchPaginated = async (startUrl: string) => {
      const seenUrls = new Set<string>();
      let nextUrl: string | undefined = startUrl;
      while (nextUrl && !seenUrls.has(nextUrl) && !shouldStop()) {
        seenUrls.add(nextUrl);
        const response = await read(nextUrl);
        if (Array.isArray(response.data)) {
          for (const page of response.data) {
            if (!seenPageIds.has(page.id)) {
              seenPageIds.add(page.id);
              allFacebookPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    try {
      await fetchPaginated(
        `${META_FACEBOOK_GRAPH_URL}/me/accounts?fields=${fields}&limit=100&access_token=${accessToken}`
      );
    } catch (error) {
      if (throttled || authorizationExpired) throw error;
      console.warn('[Instagram.pages] Could not read authorized Pages');
    }

    // Include Business Manager accounts too; keep at most four reads in flight.
    if (!shouldStop()) {
      try {
        let bizUrl:
          | string
          | undefined = `${META_FACEBOOK_GRAPH_URL}/me/businesses?limit=100&access_token=${accessToken}`;
        const seenBusinessUrls = new Set<string>();
        while (bizUrl && !seenBusinessUrls.has(bizUrl) && !shouldStop()) {
          seenBusinessUrls.add(bizUrl);
          const bizResponse = await read(bizUrl);
          const pageUrls = (bizResponse.data || []).flatMap(
            (business: { id: string }) =>
              ['owned_pages', 'client_pages'].map(
                (edge) =>
                  `${META_FACEBOOK_GRAPH_URL}/${business.id}/${edge}?fields=${fields}&limit=100&access_token=${accessToken}`
              )
          );
          for (
            let offset = 0;
            offset < pageUrls.length && !shouldStop();
            offset += 4
          ) {
            await Promise.all(
              pageUrls.slice(offset, offset + 4).map(async (url: string) => {
                try {
                  await fetchPaginated(url);
                } catch (error) {
                  if (throttled || authorizationExpired) throw error;
                  // An inaccessible business must not hide accounts from other businesses.
                }
              })
            );
          }
          bizUrl = bizResponse.paging?.next;
        }
      } catch (error) {
        if (throttled || authorizationExpired) throw error;
        // Business Manager access is not available for every authorization.
      }
    }

    if (budgetExceeded()) {
      console.warn(
        `[Instagram.pages] Discovery time budget exceeded; collected ${allFacebookPages.length} Pages`
      );
    }

    const linkedPages = allFacebookPages.filter(
      (page) =>
        page.instagram_business_account &&
        (!requiredId || page.instagram_business_account.id === requiredId)
    );
    const accounts: any[] = [];
    for (
      let offset = 0;
      offset < linkedPages.length && !budgetExceeded();
      offset += 4
    ) {
      const batch = await Promise.all(
        linkedPages.slice(offset, offset + 4).map(async (page: any) => {
          let account = page.instagram_business_account;
          // Older/partial responses still need the metadata read. Reconnect only needs the Page ID.
          if (
            !requiredId &&
            (typeof account.name !== 'string' ||
              typeof account.username !== 'string')
          ) {
            try {
              account = await read(
                `${META_FACEBOOK_GRAPH_URL}/${account.id}?fields=name,username,profile_picture_url&access_token=${accessToken}`
              );
            } catch (error) {
              if (throttled || authorizationExpired) throw error;
              return null;
            }
          }
          return {
            pageId: page.id,
            id: page.instagram_business_account.id,
            name: account.name,
            username: account.username || '',
            picture: { data: { url: account.profile_picture_url } },
          };
        })
      );
      accounts.push(...batch.filter((account) => account !== null));
    }
    return accounts;
  }

  async fetchPageInformation(
    accessToken: string,
    data: { pageId: string; id: string }
  ) {
    if (!/^\d{1,40}$/.test(data.id) || !/^\d{1,40}$/.test(data.pageId)) {
      throw new HttpException('Invalid account selection', 400);
    }
    const response = await fetch(
      `${META_FACEBOOK_GRAPH_URL}/${
        data.pageId
      }?fields=access_token,instagram_business_account{id,name,username,profile_picture_url}&access_token=${encodeURIComponent(
        accessToken
      )}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (response.status === 429) {
      throw new HttpException({ code: 'PROVIDER_RATE_LIMIT' }, 429);
    }
    const body = await response.json();
    if ([4, 17, 32, 613, 80001, 80002, 80004].includes(body.error?.code)) {
      throw new HttpException({ code: 'PROVIDER_RATE_LIMIT' }, 429);
    }
    if (body.error?.code === 190) {
      throw new HttpException({ code: 'AUTHORIZATION_EXPIRED' }, 412);
    }
    const account = body.instagram_business_account;
    if (
      !response.ok ||
      !body.access_token ||
      account?.id !== data.id ||
      !account?.username
    ) {
      throw new HttpException(
        'The page is not linked to the selected Instagram account or access was revoked',
        400
      );
    }
    return {
      id: account.id,
      name: account.name || account.username,
      picture: account.profile_picture_url,
      access_token: `${body.access_token}___${accessToken}`,
      username: account.username,
    };
  }

  async post(
    id: string,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const [response] = await this.postPending(
      id,
      token,
      postDetails,
      integration,
      type
    );

    let pendingData = response.pendingData;
    const started = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Cap below the 10-minute activity timeout of the old workflows using
      // this method: failing here (non-retryable) is safe, timing the
      // activity out is not - a retried activity would publish again.
      if (Date.now() - started > 8 * 60 * 1000) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'Media processing timed out'
        );
      }

      const check = await this.checkPostStatus(token, pendingData, integration);

      if (check.status === 'pending') {
        pendingData = check.pendingData;
        await timer(30000);
        continue;
      }

      const result =
        check.status === 'ready'
          ? await this.finalizePost(token, check.pendingData, integration)
          : check;

      if (result.status === 'completed') {
        return [
          {
            id: firstPost.id,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
          },
        ];
      }

      pendingData = result.pendingData;
      await timer(30000);
    }
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken, userToken] = token.split('___');
    const [commentPost] = postDetails;

    const { id: commentId } = await (
      await this.fetch(
        `https://${type}/${META_GRAPH_API_VERSION}/${postId}/comments?message=${encodeURIComponent(
          commentPost.message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    // Get the permalink from the parent post
    const { permalink } = await (
      await this.fetch(
        `https://${type}/${META_GRAPH_API_VERSION}/${postId}?fields=permalink&access_token=${
          userToken || accessToken
        }`
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: commentId,
        releaseURL: permalink,
        status: 'success',
      },
    ];
  }

  private setTitle(name: string) {
    switch (name) {
      case 'likes': {
        return 'Likes';
      }

      case 'followers': {
        return 'Followers';
      }

      case 'reach': {
        return 'Reach';
      }

      case 'follower_count': {
        return 'Follower Count';
      }

      case 'views': {
        return 'Views';
      }

      case 'comments': {
        return 'Comments';
      }

      case 'shares': {
        return 'Shares';
      }

      case 'saves': {
        return 'Saves';
      }

      case 'replies': {
        return 'Replies';
      }
    }

    return '';
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number,
    integration?: Integration,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    accessToken = accessToken.split('___')[0];
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await this.analyticsFetch(
        `${metaGraphUrl(
          type
        )}/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await this.analyticsFetch(
        `${metaGraphUrl(
          type
        )}/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();
    const analytics = [];

    analytics.push(
      ...(data?.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || [])
    );

    analytics.push(
      ...data2.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
        ],
      }))
    );

    return analytics;
  }

  music(accessToken: string, data: { q: string }) {
    accessToken = accessToken.split('___')[0];
    return this.fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/music/search?q=${encodeURIComponent(
        data.q
      )}&access_token=${accessToken}`
    );
  }

  postAnalyticsLifetime = true;
  storyInsightsWindowHours = 24;
  async storyAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    integration?: Integration,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    const read = async (query: string) => {
      const response = await this.analyticsFetch(
        `${metaGraphUrl(type)}/${encodeURIComponent(postId)}/insights?${query}`,
        {
          headers: { Authorization: `Bearer ${accessToken.split('___')[0]}` },
          signal: AbortSignal.timeout(15000),
        }
      );
      const body = await response.json();
      if (!Array.isArray(body.data))
        throw new Error('Story insights unavailable');
      return body.data;
    };
    const data = await read('metric=views,reach,replies,shares');
    try {
      data.push(
        ...(await read(
          'metric=navigation&breakdown=story_navigation_action_type'
        ))
      );
    } catch (error) {
      if (error instanceof RefreshToken)
        throw error; /* Optional breakdown must not discard available core metrics. */
    }
    return data.flatMap((metric: any) => {
      const rows: Array<{ label: string; value: unknown }> = [
        {
          label: metric.name,
          value: metric.total_value?.value ?? metric.values?.[0]?.value,
        },
      ];
      if (metric.name === 'navigation')
        for (const b of metric.total_value?.breakdowns || [])
          if (b.dimension_keys?.includes('story_navigation_action_type'))
            for (const result of b.results || [])
              rows.push({
                label: String(result.dimension_values?.[0]).toLowerCase(),
                value: result.value,
              });
      return rows
        .filter((r) => typeof r.value === 'number')
        .map((r) => ({
          label: r.label,
          percentageChange: 0,
          data: [{ total: String(r.value), date: today }],
        }));
    });
  }
  async listActiveStories(
    id: string,
    token: string,
    type = 'graph.facebook.com'
  ): Promise<PublishedPostsPage> {
    const { stories } = await this.getRecentStories(id, token, type);
    return {
      posts: stories
        .filter((s) => s.timestamp && Number.isFinite(Date.parse(s.timestamp)))
        .map((s) => ({
          id: s.id,
          content: s.caption || '',
          publishedAt: s.timestamp!,
          url: s.permalink || '',
          settings: { post_type: 'story' as const },
          media: s.mediaUrl
            ? [
                {
                  id: s.id,
                  path: s.mediaUrl,
                  ...(s.thumbnailUrl ? { thumbnail: s.thumbnailUrl } : {}),
                },
              ]
            : [],
        })),
    };
  }
  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    integration?: Integration,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    accessToken = accessToken.split('___')[0];
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch media insights from Instagram Graph API
      const { data } = await (
        await this.analyticsFetch(
          `${metaGraphUrl(
            type
          )}/${postId}/insights?metric=views,reach,saved,likes,comments,shares`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(15000),
          }
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value;
        if (value === undefined) continue;

        let label = '';

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'reach':
            label = 'Reach';
            break;
          case 'engagement':
            label = 'Engagement';
            break;
          case 'saved':
            label = 'Saves';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'comments':
            label = 'Comments';
            break;
          case 'shares':
            label = 'Shares';
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      if (err instanceof RefreshToken) {
        throw err;
      }
      console.warn('Instagram post insights are unavailable');
      return [];
    }
  }

  async sendDM(
    accessToken: string,
    igScopedUserId: string,
    message: string,
    type = 'graph.facebook.com'
  ): Promise<{ recipientId: string; messageId: string }> {
    const url =
      type === 'graph.instagram.com'
        ? this.commentMutationUrl(type, 'me/messages')
        : await this.resolvePageMessagesUrl(accessToken, type);
    const result = await this.sendCommentMutation(
      url,
      accessToken,
      {
        recipient: { id: igScopedUserId },
        message: { text: message },
      },
      'message_id'
    );
    return { recipientId: result.recipient_id, messageId: result.message_id };
  }

  async sendMediaDM(
    accessToken: string,
    recipientId: string,
    mediaType: 'image' | 'video',
    url: string,
    type = 'graph.facebook.com'
  ) {
    const endpoint =
      type === 'graph.instagram.com'
        ? this.commentMutationUrl(type, 'me/messages')
        : await this.resolvePageMessagesUrl(accessToken, type);
    const result = await this.sendCommentMutation(
      endpoint,
      accessToken,
      {
        recipient: { id: recipientId },
        message: { attachment: { type: mediaType, payload: { url } } },
      },
      'message_id'
    );
    return { recipientId: result.recipient_id, messageId: result.message_id };
  }

  private async resolvePageMessagesUrl(
    accessToken: string,
    type = 'graph.facebook.com'
  ): Promise<string> {
    try {
      const response = await ssrfSafeFetch(
        this.commentMutationUrl(type, 'me'),
        {
          headers: { Authorization: 'Bearer ' + accessToken.split('___')[0] },
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
        }
      );
      const body = await response.json();
      if (
        !response.ok ||
        typeof body.id !== 'string' ||
        !body.id ||
        body.error
      ) {
        throw new CommentAutomationDeliveryError('rejected');
      }
      return this.commentMutationUrl(
        type,
        encodeURIComponent(body.id) + '/messages'
      );
    } catch {
      // No mutation was attempted when resolving the account failed.
      throw new CommentAutomationDeliveryError('rejected');
    }
  }

  async sendPrivateReply(
    accessToken: string,
    igAccountId: string,
    commentId: string,
    message: string,
    button?: InstagramDmButton,
    type = 'graph.facebook.com'
  ): Promise<{ recipientId: string; messageId: string }> {
    const payload = button
      ? {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: message.slice(0, 640),
              buttons: [buildButton(button)],
            },
          },
        }
      : { text: message };
    const result = await this.sendCommentMutation(
      this.commentMutationUrl(
        type,
        encodeURIComponent(igAccountId) + '/messages'
      ),
      accessToken,
      { recipient: { comment_id: commentId }, message: payload },
      'message_id'
    );
    return { recipientId: result.recipient_id, messageId: result.message_id };
  }

  async replyToComment(
    token: string,
    commentId: string,
    message: string,
    integration: Integration | string,
    type = 'graph.facebook.com'
  ): Promise<{ id: string }> {
    const host = typeof integration === 'string' ? integration : type;
    const result = await this.sendCommentMutation(
      this.commentMutationUrl(host, encodeURIComponent(commentId) + '/replies'),
      token,
      { message },
      'id'
    );
    return { id: result.id };
  }

  async subscribeToWebhooks(
    igAccountId: string,
    pageAccessToken: string,
    type = 'graph.facebook.com',
    appId?: string
  ): Promise<boolean> {
    try {
      if (!appId) throw new Error();
      const token = pageAccessToken.split('___')[0];
      // Page installation/messaging is separate from the app-level Instagram
      // comments subscription, which is checked before flow activation.
      const requiredFields =
        type === 'graph.instagram.com'
          ? ['comments', 'messages']
          : ['messages'];
      const current = await this.checkWebhookSubscription(
        igAccountId,
        token,
        type,
        appId
      );
      if (requiredFields.every((field) => current.fields.includes(field)))
        return true;
      const accountId =
        type === 'graph.instagram.com'
          ? igAccountId
          : await this.getPageIdForIgAccount(token, igAccountId, type);
      if (!accountId) throw new Error();
      const params = new URLSearchParams({
        // A shared app can serve Chatwoot too; never replace its existing fields.
        subscribed_fields: [
          ...new Set([...current.fields, ...requiredFields]),
        ].join(','),
        access_token: token,
      });
      const response = await ssrfSafeFetch(
        `${metaGraphUrl(type)}/${encodeURIComponent(
          accountId
        )}/subscribed_apps?${params}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
        }
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (body?.error || body?.success !== true) throw new Error();
      return true;
    } catch {
      throw new Error('Could not subscribe to Instagram webhooks');
    }
  }

  async checkWebhookSubscription(
    igAccountId: string,
    pageAccessToken: string,
    type = 'graph.facebook.com',
    appId?: string
  ): Promise<{ subscribed: boolean; fields: string[] }> {
    try {
      if (!appId) throw new Error();
      const token = pageAccessToken.split('___')[0];
      const accountId =
        type === 'graph.instagram.com'
          ? igAccountId
          : await this.getPageIdForIgAccount(token, igAccountId, type);
      if (!accountId) throw new Error();
      const params = new URLSearchParams({
        fields: 'id,subscribed_fields',
        access_token: token,
      });
      const response = await ssrfSafeFetch(
        `${metaGraphUrl(type)}/${encodeURIComponent(
          accountId
        )}/subscribed_apps?${params}`,
        { signal: AbortSignal.timeout(25000), redirect: 'error' }
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (
        body?.error ||
        !Array.isArray(body?.data) ||
        body.data.some((app: any) => typeof app?.id !== 'string' || !app.id)
      ) {
        throw new Error();
      }
      const apps = body.data.filter((app: any) => app.id === appId);
      // Never overwrite unknown fields if this app is on a later result page.
      if (body.paging?.next && !apps.length) throw new Error();
      if (
        apps.some(
          (app: any) =>
            !Array.isArray(app.subscribed_fields) ||
            app.subscribed_fields.some(
              (field: any) => typeof field !== 'string' || !field
            )
        )
      ) {
        throw new Error();
      }
      const fields: string[] = apps.flatMap(
        (app: any) => app.subscribed_fields
      );
      return { subscribed: apps.length > 0, fields };
    } catch {
      throw new Error('Could not check Instagram webhook subscription');
    }
  }

  async getPageIdForIgAccount(
    pageAccessToken: string,
    igAccountId: string,
    type = 'graph.facebook.com'
  ): Promise<string | null> {
    try {
      // The page access token is scoped to a specific page.
      // We can get the page ID by calling /me with the page token.
      const response = await this.fetch(
        `${metaGraphUrl(type)}/me?fields=id&access_token=${pageAccessToken}`
      );
      const body = await response.json();
      if (body.id) {
        return body.id;
      }
      return null;
    } catch {
      return null;
    }
  }

  async ensureWebhookSubscription(
    pageAccessToken: string,
    igAccountId: string,
    type = 'graph.facebook.com',
    appId?: string
  ): Promise<boolean> {
    // Facebook Login uses the linked Page; Instagram Login uses the IG account.
    return this.subscribeToWebhooks(igAccountId, pageAccessToken, type, appId);
  }

  async getMediaMetadata(
    mediaId: string,
    accessToken: string,
    type = 'graph.facebook.com'
  ): Promise<{
    id: string;
    permalink?: string;
    caption?: string;
    thumbnailUrl?: string;
    mediaType?: string;
    isAd?: boolean;
  }> {
    accessToken = accessToken.split('___')[0];
    // boost_eligibility_info so existe em "Instagram API with Facebook Login"
    // (host graph.facebook.com). "Instagram API with Instagram Login"
    // (host graph.instagram.com / standalone) NAO expoe esse campo —
    // documentado em https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
    // Quando sabemos pelo host que nao vai funcionar, pulamos o campo direto.
    // Caso o host nao seja reconhecido, o retry abaixo cobre como safety net.
    const baseFields =
      'id,caption,media_type,media_url,thumbnail_url,permalink';
    const supportsBoostField = type.includes('graph.facebook.com');
    const withBoost = `${baseFields},boost_eligibility_info`;
    const initialFields = supportsBoostField ? withBoost : baseFields;

    const tryFetch = async (fields: string) => {
      const response = await fetch(
        `${metaGraphUrl(
          type
        )}/${mediaId}?fields=${fields}&access_token=${accessToken}`
      );
      const body = await response.json();
      return { response, body };
    };

    let { response, body } = await tryFetch(initialFields);
    if (supportsBoostField && (!response.ok || body?.error)) {
      const message: string = body?.error?.message ?? '';
      const isNonexistingField =
        /nonexisting field/i.test(message) &&
        /boost_eligibility_info/i.test(message);
      if (isNonexistingField) {
        // Defensive: host eh facebook mas o app type nao suporta o campo.
        ({ response, body } = await tryFetch(baseFields));
      }
    }

    if (!response.ok || body?.error) {
      throw new Error(
        `IG getMediaMetadata failed (HTTP ${response.status}): ${
          body?.error?.message ?? JSON.stringify(body).slice(0, 200)
        }`
      );
    }

    const eligibleToBoost = body?.boost_eligibility_info?.eligible_to_boost;
    const isAd =
      typeof eligibleToBoost === 'boolean' ? !eligibleToBoost : undefined;

    return {
      id: body.id,
      permalink: body.permalink,
      caption: body.caption,
      thumbnailUrl: body.thumbnail_url ?? body.media_url,
      mediaType: body.media_type,
      isAd,
    };
  }

  async getRecentMedia(
    igAccountId: string,
    accessToken: string,
    type = 'graph.facebook.com',
    limit = 25,
    after?: string
  ): Promise<{
    posts: Array<{
      id: string;
      caption?: string;
      mediaType: string;
      mediaUrl?: string;
      thumbnailUrl?: string;
      permalink?: string;
      timestamp?: string;
    }>;
    nextCursor: string | null;
  }> {
    try {
      const [pageToken, userToken] = accessToken.split('___');
      const params = new URLSearchParams({
        fields:
          'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
        limit: String(limit),
        access_token: userToken || pageToken,
        ...(after ? { after } : {}),
      });
      const response = await ssrfSafeFetch(
        `${metaGraphUrl(type)}/${encodeURIComponent(
          igAccountId
        )}/media?${params}`,
        { signal: AbortSignal.timeout(25000), redirect: 'error' }
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (
        body?.error ||
        !Array.isArray(body?.data) ||
        body.data.some(
          (item: any) =>
            !item ||
            typeof item.id !== 'string' ||
            !item.id ||
            typeof item.media_type !== 'string' ||
            !item.media_type
        )
      ) {
        throw new Error();
      }
      const nextCursor = body.paging?.next ? body.paging?.cursors?.after : null;
      if (
        body.paging?.next &&
        (typeof nextCursor !== 'string' || !nextCursor || nextCursor === after)
      ) {
        throw new Error();
      }
      return {
        posts: body.data.map((m: any) => ({
          id: m.id,
          caption: m.caption,
          mediaType: m.media_type,
          mediaUrl: m.media_url,
          thumbnailUrl: m.thumbnail_url,
          permalink: m.permalink,
          timestamp: m.timestamp,
        })),
        nextCursor,
      };
    } catch {
      throw new Error('Could not retrieve Instagram media');
    }
  }

  async getRecentStories(
    igAccountId: string,
    accessToken: string,
    type = 'graph.facebook.com'
  ): Promise<{
    stories: Array<{
      id: string;
      caption?: string;
      mediaType: string;
      mediaUrl?: string;
      thumbnailUrl?: string;
      permalink?: string;
      timestamp?: string;
    }>;
  }> {
    // Instagram Graph API only exposes active stories (last 24h) via this edge.
    try {
      const [pageToken, userToken] = accessToken.split('___');
      const params = new URLSearchParams({
        fields:
          'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
        access_token: userToken || pageToken,
        limit: '100',
      });
      const stories: any[] = [];
      const seen = new Set<string>();
      for (let page = 0; page < 20; page++) {
        const response = await ssrfSafeFetch(
          `${metaGraphUrl(type)}/${encodeURIComponent(
            igAccountId
          )}/stories?${params}`,
          { signal: AbortSignal.timeout(25000), redirect: 'error' }
        );
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (
          body?.error ||
          !Array.isArray(body?.data) ||
          body.data.some(
            (item: any) =>
              !item ||
              typeof item.id !== 'string' ||
              !item.id ||
              typeof item.media_type !== 'string' ||
              !item.media_type
          )
        ) {
          throw new Error();
        }
        stories.push(
          ...body.data.map((m: any) => ({
            id: m.id,
            caption: m.caption,
            mediaType: m.media_type,
            mediaUrl: m.media_url,
            thumbnailUrl: m.thumbnail_url,
            permalink: m.permalink,
            timestamp: m.timestamp,
          }))
        );
        const after = body.paging?.next
          ? body.paging?.cursors?.after
          : undefined;
        if (!body.paging?.next) return { stories };
        if (typeof after !== 'string' || !after || seen.has(after))
          throw new Error();
        seen.add(after);
        params.set('after', after);
      }
      throw new Error();
    } catch {
      throw new Error('Could not retrieve Instagram stories');
    }
  }

  canImportPublishedPost(settings: Record<string, unknown>) {
    return settings.post_type !== 'story';
  }

  reportMetrics: ReportMetricsMap = instagramReportMetrics;

  async listPublishedPosts(
    id: string,
    token: string,
    cursor?: string,
    host = 'graph.facebook.com'
  ): Promise<PublishedPostsPage> {
    const [pageToken, userToken] = token.split('___');
    const fields =
      'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,children{id,media_type,media_url,thumbnail_url}';
    const params = new URLSearchParams({
      fields,
      limit: '50',
      access_token: userToken || pageToken,
      ...(cursor ? { after: cursor } : {}),
    });
    const data = await (
      await this.fetch(
        `https://${host}/${META_GRAPH_API_VERSION}/${id}/media?${params}`,
        { signal: AbortSignal.timeout(60000) }
      )
    ).json();
    if (!Array.isArray(data.data)) {
      throw new Error('The provider did not return a valid media page');
    }
    const posts = [];
    for (const item of data.data) {
      let media =
        item.media_type === 'CAROUSEL_ALBUM' ? item.children?.data : [item];
      // Expanded edges can themselves be paginated; never silently truncate an album.
      if (
        item.media_type === 'CAROUSEL_ALBUM' &&
        (!media || item.children?.paging?.next)
      ) {
        media = [];
        let after: string | undefined;
        do {
          const childParams = new URLSearchParams({
            fields: 'id,media_type,media_url,thumbnail_url',
            limit: '100',
            access_token: userToken || pageToken,
            ...(after ? { after } : {}),
          });
          const children = await (
            await this.fetch(
              `https://${host}/${META_GRAPH_API_VERSION}/${item.id}/children?${childParams}`,
              { signal: AbortSignal.timeout(60000) }
            )
          ).json();
          if (!Array.isArray(children.data))
            throw new Error('Invalid carousel media page');
          media.push(...children.data);
          const next = children.paging?.next
            ? children.paging?.cursors?.after
            : undefined;
          if (children.paging?.next && (!next || next === after))
            throw new Error('Invalid carousel cursor');
          after = next;
        } while (after);
      }
      if (
        !item.id ||
        !item.timestamp ||
        !item.permalink ||
        !Number.isFinite(Date.parse(item.timestamp))
      ) {
        throw new Error(
          'The provider returned a media item without its identity or publication date'
        );
      }
      posts.push({
        id: String(item.id),
        content: item.caption || '',
        publishedAt: item.timestamp,
        url: item.permalink,
        media: (media || [])
          .filter((m: any) => m.media_url)
          .map((m: any) => ({
            id: String(m.id),
            path: m.media_url,
            ...(m.thumbnail_url ? { thumbnail: m.thumbnail_url } : {}),
          })),
      });
    }
    const nextCursor = data.paging?.next
      ? data.paging?.cursors?.after
      : undefined;
    if (data.paging?.next && (!nextCursor || nextCursor === cursor))
      throw new Error('Invalid media cursor');
    return { posts, nextCursor };
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    if (firstPost.length > 10) {
      return 'Instagram carousel only supports up to 10 media attachments';
    }
    if (settings?.post_type === 'story' && firstPost.length !== 1)
      return 'Instagram Stories support only one media per post';
    if (settings?.post_type === 'story' && settings?.collaborators?.length)
      return 'Collaborators are not supported for Stories';
    for (const [index, media] of firstPost.entries()) {
      if (
        media.content_type &&
        !['image/jpeg', 'image/png', 'video/mp4'].includes(media.content_type)
      )
        return `Media ${
          index + 1
        }: use a JPEG/PNG image or a prepared MP4 video`;
      if (media.content_type === 'video/mp4') {
        if (media.width > 1920)
          return `Video ${index + 1}: maximum width is 1920 pixels`;
        if (media.video_codec && !['h264', 'hevc'].includes(media.video_codec))
          return `Video ${index + 1}: use H.264 or HEVC`;
        if (
          firstPost.length === 1 &&
          settings?.post_type !== 'story' &&
          media.duration_seconds !== undefined &&
          (media.duration_seconds < 3 || media.duration_seconds > 900)
        )
          return 'Reels duration must be between 3 seconds and 15 minutes';
      }
      if (
        media.content_type?.startsWith('image/') &&
        media.width &&
        media.height &&
        settings?.post_type !== 'story'
      ) {
        const ratio = media.width / media.height;
        if (ratio < 0.8 || ratio > 1.91)
          return `Image ${
            index + 1
          }: feed aspect ratio must be between 4:5 and 1.91:1`;
      }
    }
    if (this.assetBoolean(settings?.is_trial_reel)) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    if (settings?.audio?.id) {
      if (settings?.post_type === 'story') {
        return 'Audio can only be added to Reels, not to Stories';
      }
      if ((firstPost?.length ?? 0) > 1) {
        return 'Audio can only be added to a single video Reel';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Audio can only be added to a video Reel';
      }
    }
    return true;
  }

  private stripHandle(handle: string) {
    return handle.replace(/^@+/, '');
  }

  private async igContainerStatus(
    containerId: string,
    checkToken: string,
    type: string
  ): Promise<string> {
    const { status_code, status } = await (
      await this.fetch(
        `https://${type}/${META_GRAPH_API_VERSION}/${containerId}?access_token=${checkToken}&fields=status_code,status`,
        undefined,
        '',
        0,
        true
      )
    ).json();

    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      const handleError: ReturnType<SocialAbstract['handleErrors']> =
        this.handleErrors(status || '', 200);
      if (handleError?.type === 'disconnect') {
        throw new Disconnect(
          this.identifier,
          JSON.stringify({ status_code, status }),
          '{}',
          handleError?.value
        );
      }
      throw new BadBody(
        this.identifier,
        JSON.stringify({ status_code, status }),
        '{}',
        handleError?.value ||
          (status !== status_code && status) ||
          'Instagram could not process the media'
      );
    }

    return status_code;
  }

  private async igPermalink(
    mediaId: string,
    checkToken: string,
    type: string,
    integration: Integration
  ): Promise<string> {
    try {
      const { permalink } = await (
        await this.fetch(
          `https://${type}/${META_GRAPH_API_VERSION}/${mediaId}?fields=permalink&access_token=${checkToken}`
        )
      ).json();
      return permalink;
    } catch (err) {
      return `https://www.instagram.com/${integration.profile}`;
    }
  }

  async postPending(
    id: string,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken] = token.split('___');
    const [firstPost] = postDetails;
    const isStory = firstPost.settings.post_type === 'story';
    const collaborators =
      firstPost?.settings?.collaborators?.length && !isStory
        ? `&collaborators=${encodeURIComponent(
            JSON.stringify(
              firstPost?.settings?.collaborators.map((p) =>
                this.stripHandle(p.label)
              )
            )
          )}`
        : ``;
    const isTrialReel = this.assetBoolean(firstPost.settings.is_trial_reel);
    const medias = await Promise.all(
      firstPost?.media?.map(async (m) => {
        const caption =
          firstPost.media?.length === 1
            ? `&caption=${encodeURIComponent(firstPost.message)}`
            : ``;
        const isCarousel =
          (firstPost?.media?.length || 0) > 1 && !isStory
            ? `&is_carousel_item=true`
            : ``;
        const mediaType = hasExtension(m.path, 'mp4')
          ? firstPost?.media?.length === 1
            ? isStory
              ? `video_url=${m.path}&media_type=STORIES`
              : firstPost.settings.cover?.path || m?.thumbnail
              ? `video_url=${
                  m.path
                }&media_type=REELS&cover_url=${encodeURIComponent(
                  firstPost.settings.cover?.path || m.thumbnail
                )}`
              : `video_url=${m.path}&media_type=REELS&thumb_offset=${
                  m?.thumbnailTimestamp || 0
                }`
            : isStory
            ? `video_url=${m.path}&media_type=STORIES`
            : `video_url=${m.path}&media_type=VIDEO&thumb_offset=${
                m?.thumbnailTimestamp || 0
              }`
          : isStory
          ? `image_url=${m.path}&media_type=STORIES`
          : `image_url=${m.path}`;

        const trialParams = isTrialReel
          ? `&trial_params=${encodeURIComponent(
              JSON.stringify({
                graduation_strategy:
                  firstPost.settings.graduation_strategy || 'MANUAL',
              })
            )}`
          : ``;

        // collaborators are not allowed on carousel child items,
        // they go on the carousel container instead
        const itemCollaborators =
          firstPost?.media?.length === 1 ? collaborators : ``;

        // audio_configuration is only supported for Reels (single video, not a story)
        // and only with Facebook Login (not Instagram Login / graph.instagram.com)
        const audioConfiguration =
          firstPost?.settings?.audio?.id &&
          type === 'graph.facebook.com' &&
          !isStory &&
          firstPost?.media?.length === 1 &&
          hasExtension(m.path, 'mp4')
            ? `&audio_configuration=${encodeURIComponent(
                JSON.stringify({
                  audio_id: firstPost.settings.audio.id,
                  ...(typeof firstPost.settings.audio.audio_volume !==
                  'undefined'
                    ? { audio_volume: +firstPost.settings.audio.audio_volume }
                    : {}),
                  ...(typeof firstPost.settings.audio.video_volume !==
                  'undefined'
                    ? { video_volume: +firstPost.settings.audio.video_volume }
                    : {}),
                })
              )}`
            : ``;

        const { id: photoId } = await (
          await this.fetch(
            `https://${type}/${META_GRAPH_API_VERSION}/${id}/media?${mediaType}${isCarousel}${itemCollaborators}${trialParams}${audioConfiguration}&access_token=${accessToken}${caption}`,
            {
              method: 'POST',
            }
          )
        ).json();

        return photoId;
      }) || []
    );

    // Containers are invisible until media_publish runs: the processing wait
    // and the publish itself move to checkPostStatus / finalizePost so a
    // failure there can never re-create (and re-publish) the whole post.
    return [
      {
        id: firstPost.id,
        postId: '',
        releaseURL: '',
        status: 'pending',
        pendingData: {
          type,
          postType:
            isStory && medias.length > 1
              ? 'stories'
              : medias.length === 1
              ? 'single'
              : 'carousel',
          containers: medias,
          message: firstPost?.message || '',
          ...(collaborators
            ? {
                collaborators: firstPost.settings.collaborators!.map((p) =>
                  this.stripHandle(p.label)
                ),
              }
            : {}),
        },
      },
    ];
  }

  override async checkPostStatus(
    token: string,
    pendingData: {
      type: string;
      postType: 'stories' | 'single' | 'carousel';
      containers: string[];
      message?: string;
      carouselId?: string;
      collaborators?: string[];
    },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    const [accessToken, userToken] = token.split('___');
    const checkToken = userToken || accessToken;

    // the carousel container was already created: wait for it
    if (pendingData.carouselId) {
      const status = await this.igContainerStatus(
        pendingData.carouselId,
        checkToken,
        pendingData.type
      );

      if (status === 'IN_PROGRESS') {
        return { status: 'pending', pendingData };
      }

      // a previous finalizePost published but died before reporting: the post
      // is live, never publish again
      if (status === 'PUBLISHED') {
        return {
          status: 'completed',
          postId: pendingData.carouselId,
          releaseURL: `https://www.instagram.com/${integration.profile}`,
        };
      }

      return { status: 'ready', pendingData };
    }

    for (const containerId of pendingData.containers) {
      const status = await this.igContainerStatus(
        containerId,
        checkToken,
        pendingData.type
      );

      if (status === 'IN_PROGRESS') {
        return { status: 'pending', pendingData };
      }

      if (status === 'PUBLISHED') {
        // a previous finalizePost died mid-way: a single post is fully live,
        // stories are resumed by finalizePost (it skips published containers)
        if (pendingData.postType === 'single') {
          return {
            status: 'completed',
            postId: containerId,
            releaseURL: `https://www.instagram.com/${integration.profile}`,
          };
        }
      }
    }

    return { status: 'ready', pendingData };
  }

  override async finalizePost(
    token: string,
    pendingData: {
      type: string;
      postType: 'stories' | 'single' | 'carousel';
      containers: string[];
      message?: string;
      carouselId?: string;
      collaborators?: string[];
    },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    const [accessToken, userToken] = token.split('___');
    const checkToken = userToken || accessToken;
    const igId = integration.internalId;

    if (pendingData.postType === 'stories') {
      // Stories don't support carousels - publish each media as a separate
      // story, skipping containers a previous (crashed) run already published
      let lastMediaId = '';
      for (const mediaCreationId of pendingData.containers) {
        const status = await this.igContainerStatus(
          mediaCreationId,
          checkToken,
          pendingData.type
        );
        if (status === 'PUBLISHED') {
          continue;
        }

        const { id: mediaId } = await (
          await this.fetch(
            `https://${pendingData.type}/${META_GRAPH_API_VERSION}/${igId}/media_publish?creation_id=${mediaCreationId}&access_token=${accessToken}&field=id`,
            {
              method: 'POST',
            }
          )
        ).json();
        lastMediaId = mediaId;
      }

      return {
        status: 'completed',
        postId: lastMediaId || pendingData.containers.at(-1)!,
        releaseURL: !lastMediaId
          ? `https://www.instagram.com/${integration.profile}`
          : await this.igPermalink(
              lastMediaId,
              checkToken,
              pendingData.type,
              integration
            ),
      };
    }

    if (pendingData.postType === 'carousel' && !pendingData.carouselId) {
      // create the carousel container and hand back to the workflow to wait
      // for it (an orphan container from a crashed run is invisible, so
      // re-running this is safe)
      const { id: containerId } = await (
        await this.fetch(
          `https://${
            pendingData.type
          }/${META_GRAPH_API_VERSION}/${igId}/media?caption=${encodeURIComponent(
            pendingData.message || ''
          )}&media_type=CAROUSEL&children=${encodeURIComponent(
            pendingData.containers.join(',')
          )}${
            pendingData.collaborators?.length
              ? `&collaborators=${encodeURIComponent(
                  JSON.stringify(pendingData.collaborators)
                )}`
              : ``
          }&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();

      return {
        status: 'pending',
        pendingData: { ...pendingData, carouselId: containerId },
      };
    }

    const creationId =
      pendingData.postType === 'carousel'
        ? pendingData.carouselId
        : pendingData.containers[0];

    const { id: mediaId } = await (
      await this.fetch(
        `https://${pendingData.type}/${META_GRAPH_API_VERSION}/${igId}/media_publish?creation_id=${creationId}&access_token=${accessToken}&field=id`,
        {
          method: 'POST',
        }
      )
    ).json();

    return {
      status: 'completed',
      postId: mediaId,
      releaseURL: await this.igPermalink(
        mediaId,
        checkToken,
        pendingData.type,
        integration
      ),
    };
  }

  async listComments(
    token: string,
    postId: string,
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<SocialCommentDetails[]> {
    const comments: SocialCommentDetails[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listCommentsPage(
        token,
        postId,
        integration,
        cursor,
        type
      );
      comments.push(...page.comments);
      cursor = page.nextCursor;
    } while (cursor);
    return comments;
  }

  // The inbox persists each bounded chunk and its cursor. Large histories make
  // progress across rounds instead of restarting after a request limit.
  async listCommentsPage(
    token: string,
    postId: string,
    integration: Integration,
    cursor?: string,
    type = 'graph.facebook.com'
  ): Promise<{ comments: SocialCommentDetails[]; nextCursor?: string }> {
    const [accessToken] = token.split('___');
    const fields = 'id,text,timestamp,username,parent_id,from{id,username}';
    const state: {
      after?: string;
      complete: boolean;
      replies: Array<{ id: string; after: string }>;
    } = cursor ? JSON.parse(cursor) : { complete: false, replies: [] };
    if (
      typeof state.complete !== 'boolean' ||
      !Array.isArray(state.replies) ||
      state.replies.length > 50
    )
      throw new Error('Invalid comments cursor');
    const comments = new Map<string, SocialCommentDetails>();
    const seen = new Set<string>();
    const nextCursor = (page: any) => {
      if (!page.paging?.next) return undefined;
      const after = page.paging?.cursors?.after;
      if (typeof after !== 'string' || !after || after.length > 4096)
        throw new Error('Invalid comments cursor');
      return after;
    };
    const remember = (comment: any, parentId?: string) => {
      if (
        typeof comment.id !== 'string' ||
        !comment.id ||
        !Number.isFinite(Date.parse(comment.timestamp))
      )
        throw new Error('Invalid comment');
      comments.set(comment.id, {
        id: comment.id,
        parentId: parentId || comment.parent_id,
        content: comment.text || '',
        authorName: comment.from?.username || comment.username,
        authorId: comment.from?.id,
        publishedAt: comment.timestamp,
      });
    };
    for (
      let request = 0;
      request < 10 && (state.replies.length || !state.complete);
      request++
    ) {
      const reply = state.replies.shift();
      const edge = reply ? 'replies' : 'comments';
      const id = reply?.id || postId;
      const after = reply?.after || state.after;
      if (
        after !== undefined &&
        (typeof after !== 'string' || !after || after.length > 4096)
      )
        throw new Error('Invalid comments cursor');
      const key = `${id}:${edge}:${after || ''}`;
      if (seen.has(key)) throw new Error('Invalid comments cursor');
      seen.add(key);
      const params = new URLSearchParams({
        fields: reply ? fields : `${fields},replies.limit(50){${fields}}`,
        limit: '50',
        access_token: accessToken,
        ...(after ? { after } : {}),
      });
      const page = await (
        await this.fetch(
          `https://${type}/${META_GRAPH_API_VERSION}/${encodeURIComponent(
            id
          )}/${edge}?${params}`,
          { signal: AbortSignal.timeout(10000) }
        )
      ).json();
      if (!Array.isArray(page?.data))
        throw new Error('Invalid comments response');
      for (const comment of page.data) {
        remember(comment, reply?.id);
        if (!reply && comment.replies) {
          if (!Array.isArray(comment.replies.data))
            throw new Error('Invalid comment replies');
          for (const child of comment.replies.data) remember(child, comment.id);
          const afterReply = nextCursor(comment.replies);
          if (afterReply)
            state.replies.push({ id: comment.id, after: afterReply });
        }
      }
      const next = nextCursor(page);
      if (next && next === after) throw new Error('Invalid comments cursor');
      if (reply) {
        if (next) state.replies.unshift({ id, after: next });
      } else {
        state.after = next;
        state.complete = !next;
      }
    }
    return {
      comments: [...comments.values()],
      nextCursor:
        state.complete && !state.replies.length
          ? undefined
          : JSON.stringify(state),
    };
  }

  private async accountInsights(
    id: string,
    token: string,
    type: string,
    since: number,
    until: number
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');

    const { data, ...all } = await (
      await fetch(
        `https://${type}/${META_GRAPH_API_VERSION}/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await fetch(
        `https://${type}/${META_GRAPH_API_VERSION}/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();
    const analytics = [];

    analytics.push(
      ...(data?.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 0,
        data: d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || [])
    );

    analytics.push(
      ...data2.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 0,
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
        ],
      }))
    );

    return analytics;
  }

  @Tool({
    description:
      'Search audio (music or original sounds) to attach to a Reel via the "audio" setting, an empty query returns trending audio',
    dataSchema: [
      {
        key: 'q',
        type: 'string',
        description: 'Search query, leave empty for trending audio',
      },
      {
        key: 'type',
        type: 'string',
        description: 'Either "music" or "original_sound", defaults to "music"',
      },
    ],
  })
  async audioSearch(
    token: string,
    data: { q?: string; type?: 'music' | 'original_sound' },
    internalId?: string
  ) {
    const [accessToken, userToken] = token.split('___');
    const audioType =
      data?.type === 'original_sound' ? 'original_sound' : 'music';

    const { audio } = await (
      await this.fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/ig_audio?audio_type=${audioType}&user_id=${internalId}${
          data?.q ? `&search_query=${encodeURIComponent(data.q)}` : ''
        }&access_token=${userToken || accessToken}`
      )
    ).json();

    return (audio || []).map((audio: any) => ({
      id: audio.audio_id,
      title: audio.title || '',
      artist: audio.display_artist || audio.ig_username || '',
      image:
        audio.cover_artwork_thumbnail_uri ||
        audio.cover_artwork_thumbnail_url ||
        audio.profile_picture_url ||
        '',
      duration: audio.duration_in_ms || 0,
      previewUrl: audio.download_url || '',
    }));
  }

  private commentMutationUrl(host: string, path: string): string {
    if (!['graph.facebook.com', 'graph.instagram.com'].includes(host)) {
      throw new CommentAutomationDeliveryError('rejected');
    }
    return metaGraphUrl(host) + '/' + path;
  }

  private async sendCommentMutation(
    url: string,
    token: string,
    payload: Record<string, unknown>,
    idField: 'id' | 'message_id'
  ): Promise<Record<string, string>> {
    try {
      // Meta has no idempotency key: a timeout or malformed success must never be retried.
      const response = await ssrfSafeFetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token.split('___')[0],
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
        redirect: 'error',
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || body?.error) {
        throw new CommentAutomationDeliveryError(
          response.status >= 400 && response.status < 500 && body?.error
            ? 'rejected'
            : 'unknown'
        );
      }
      if (typeof body?.[idField] !== 'string' || !body[idField]) {
        throw new CommentAutomationDeliveryError('unknown');
      }
      return body;
    } catch (error) {
      if (error instanceof CommentAutomationDeliveryError) throw error;
      throw new CommentAutomationDeliveryError('unknown');
    }
  }
}
