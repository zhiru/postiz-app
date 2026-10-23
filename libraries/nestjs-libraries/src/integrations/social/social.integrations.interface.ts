import { Integration } from '@prisma/client';

export class CommentAutomationDeliveryError extends Error {
  constructor(public readonly outcome: 'rejected' | 'unknown') {
    super(
      outcome === 'rejected'
        ? 'Instagram rejected this delivery.'
        : 'Instagram delivery result is unknown; do not retry automatically.'
    );
    this.name = 'CommentAutomationDeliveryError';
  }
}

export interface ClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
}
export interface IAuthenticator {
  authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string>;
  refreshToken(
    refreshToken: string,
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails>;
  reConnect?(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse>;
  analytics?(
    id: string,
    accessToken: string,
    date: number,
    integration?: Integration
  ): Promise<AnalyticsData[]>;
  postAnalytics?(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number,
    integration?: Integration
  ): Promise<AnalyticsData[]>;
  resolveReleaseId?(
    accessToken: string,
    releaseId: string,
    integration: Integration,
    settings: any,
    releaseURL: string
  ): Promise<
    | { postId: string; releaseURL: string }
    | { pending: true }
    | { unavailable: true }
    | undefined
  >; // Final id + URL to persist when the stored releaseId is still a publish id, pending when the platform has no final id yet, unavailable when the post will never get one, undefined when nothing to resolve
  releaseUrl?(
    accessToken: string,
    releaseId: string,
    integration: Integration
  ): Promise<string | undefined>; // URL of a post the user connected by hand
  changeNickname?(
    id: string,
    accessToken: string,
    name: string
  ): Promise<{ name: string }>;
  changeProfilePicture?(
    id: string,
    accessToken: string,
    url: string
  ): Promise<{ url: string }>;
  missing?(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]>;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}

// The cross channel report needs comparable columns, but every provider names
// its own metrics ("Page Impressions", "Reach", "IMPRESSION"...). Each provider
// declares which of ITS OWN analytics() labels feed each canonical metric, so
// the collector can translate without ever knowing which provider it is holding.
//
// The semantics of each key are fixed, and that is what decides how the report
// aggregates it:
//   followers       - a running total (stock). The latest day in the period wins.
//   followersGained - followers won on that day (flow). Summed over the period.
//   reach           - impressions / views / reach on that day (flow). Summed.
//   engagement      - interactions on that day (flow). Summed.
// A provider reports whichever of the four it actually has, and nothing else.
// followers and followersGained are never mixed: one is a snapshot, the other a
// delta, and adding them together would mean nothing.
export type ReportMetric =
  | 'followers'
  | 'followersGained'
  | 'reach'
  | 'engagement';

export type ReportMetricsMap = Partial<Record<ReportMetric, string[]>>;

export type GenerateAuthUrlResponse = {
  url: string;
  codeVerifier: string;
  state: string;
};

export type AuthTokenDetails = {
  id: string;
  name: string;
  error?: string;
  accessToken: string; // The obtained access token
  refreshToken?: string; // The refresh token, if applicable
  expiresIn?: number; // The duration in seconds for which the access token is valid
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
};

export interface ISocialMediaIntegration {
  post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post

  postPending?(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // May return status=pending for workflow polling

  comment?(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post

  listCommentsPage?(
    accessToken: string,
    postId: string,
    integration: Integration,
    cursor?: string
  ): Promise<{ comments: SocialCommentDetails[]; nextCursor?: string }>;
  listComments?(
    accessToken: string,
    postId: string,
    integration: Integration
  ): Promise<SocialCommentDetails[]>; // Comments other people left on a published post, newest first

  replyToComment?(
    accessToken: string,
    commentId: string,
    message: string,
    integration: Integration
  ): Promise<{ id: string }>; // Answers one of those comments
}

// A comment as the platform returned it, flattened to what the inbox needs.
export type SocialCommentDetails = {
  id: string; // The platform's comment id
  parentId?: string; // Set when the comment is itself a reply
  content: string;
  authorName?: string;
  authorId?: string;
  permalink?: string;
  publishedAt: string; // ISO date
};

export type PostResponse = {
  id: string; // The db internal id of the post
  postId: string; // The ID of the scheduled post returned by the platform
  releaseURL: string; // The URL of the post on the platform
  status: string; // Status of the operation or initial post status
  pendingData?: any; // Small provider state; credentials are forbidden
};

// Once a finalization mutation was accepted, status checks must never authorize it again.
export type PendingCheckResponse =
  | { status: 'pending'; pendingData: any }
  | { status: 'ready'; pendingData: any }
  | { status: 'completed'; postId: string; releaseURL: string };

export type PostDetails<T = any> = {
  id: string;
  message: string;
  settings: T;
  media?: MediaContent[];
  poll?: PollDetails;
};

export type PollDetails = {
  options: string[]; // Array of poll options
  duration: number; // Duration in hours for which the poll will be active
};

export type MediaContent = {
  type: 'image' | 'video'; // Type of the media content
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
};

export type FetchPageInformationResult = {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
};

export interface SocialProvider
  extends IAuthenticator,
    ISocialMediaIntegration {
  identifier: string;
  checkRemoteDeletion?(
    accountId: string,
    accessToken: string,
    mediaId: string
  ): Promise<void>;
  deletePublishedPost?(
    accessToken: string,
    mediaId: string
  ): Promise<{ success: true; deletedId: string }>;
  canImportPublishedPost?: (settings: Record<string, unknown>) => boolean;
  listPublishedPosts?(
    id: string,
    accessToken: string,
    cursor?: string
  ): Promise<PublishedPostsPage>;
  refreshWait?: boolean;
  // Maps this provider's own analytics() labels onto the canonical report
  // metrics. Providers without analytics() simply leave it out.
  reportMetrics?: ReportMetricsMap;
  convertToJPEG?: boolean;
  stripLinks?: () => boolean;
  refreshErrorMessage?(err: any): string | undefined;
  refreshCron?: boolean;
  // Provider cujo refreshToken() e stub (sem mecanismo nativo de renovacao —
  // ex.: facebook/instagram via Facebook Login, cujo Page Access Token nao se
  // renova por refresh_token). O cron em lote NAO deve tratar o retorno vazio
  // do stub como falha real e desconectar (falso positivo); a renovacao
  // acontece via MetaSystemUserService (System User token) ou no post-time.
  noNativeRefresh?: boolean;
  requiresCredentialFreeWorkflow?: boolean;
  supportsRecurringPosts?: boolean;
  dto?: any;
  maxLength: (additionalSettings?: any, settings?: any) => number;
  checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true>;
  checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  migrationMatch(
    auth: Pick<AuthTokenDetails, 'id' | 'username'>,
    integration: Integration
  ): boolean;
  finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  isWeb3?: boolean;
  isChromeExtension?: boolean;
  extensionCookies?: { name: string; domain: string }[];
  editor: 'none' | 'normal' | 'markdown' | 'html';
  inlineImages?: (settings?: any) => boolean;
  customFields?: () => Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
      hint?: string;
    }[]
  >;
  name: string;
  toolTip?: string;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  // Quando true, o controller de OAuth usa refreshToken/expiresIn vindos do
  // authenticate() em vez de body.refresh/default no fluxo de reConnect.
  // Necessario para providers cujo access token expira em horas (YouTube/GMB),
  // onde perder o refresh_token real do OAuth quebra a renovacao automatica.
  keepReconnectAuthTokens?: boolean;
  // Revoga programaticamente o token antigo antes da reconexao. Forca o
  // provider a exibir tela de consent e emitir refresh_token novo, mesmo
  // quando a conta ja autorizou o app antes (Google pula consent silencioso).
  revokeToken?(accessToken: string): Promise<void>;
  scopes: string[];
  externalUrl?: (
    url: string
  ) => Promise<{ client_id: string; client_secret: string }>;
  mention?: (
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) => Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  >;
  mentionFormat?(idOrHandle: string, name: string): string;
  reusableAccountAuthorization?: boolean;
  pages?(accessToken: string): Promise<any[]>;
  fetchPageInformation?(
    accessToken: string,
    data: any
  ): Promise<FetchPageInformationResult>;
}

export interface PublishedPlatformPost {
  id: string;
  content: string;
  publishedAt: string;
  url: string;
  media: Array<{ id: string; path: string; thumbnail?: string }>;
}

export interface PublishedPostsPage {
  posts: PublishedPlatformPost[];
  nextCursor?: string;
}
