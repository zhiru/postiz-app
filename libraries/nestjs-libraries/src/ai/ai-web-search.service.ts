import { ssrfSafeFetch } from '../dtos/webhooks/ssrf.safe.dispatcher';
import { TextOptionsSchema } from './ai-credential.schemas';
import { ResolvedAiCredential } from './ai-credential.service';
import { isSafePublicHttpsUrl } from '../dtos/webhooks/webhook.url.validator';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  tavily,
  type TavilyExtractResponse,
  type TavilySearchResponse,
} from '@tavily/core';
import { AiProviderResolverService } from './ai-provider-resolver.service';
import { WebSearchOptions } from './ai-credential.schemas';

const TAVILY_TIMEOUT_MS = 45_000;
export const MAX_EXTRACT_URLS = 20;

/**
 * Hosts privados/local-only que NUNCA devem virar destino de extract
 * (defesa em profundidade contra SSRF, mesmo o Tavily sendo remoto —
 * pode ser reusado por outro consumer no futuro).
 */
const PRIVATE_HOST_PATTERNS: Array<RegExp> = [
  /^localhost$/i,
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^192\.168\./, // 192.168.0.0/16
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique local
  /^fd00:/i, // IPv6 unique local
];

export interface SearchOpts {
  maxResults?: number;
  topic?: 'general' | 'news' | 'finance';
  days?: number;
  includeAnswer?: boolean;
  searchDepth?: 'basic' | 'advanced';
}

export interface ExtractOpts {
  extractDepth?: 'basic' | 'advanced';
  format?: 'markdown' | 'text';
  query?: string;
}

@Injectable()
export class AiWebSearchService {
  private readonly _logger = new Logger(AiWebSearchService.name);

  constructor(private _resolver: AiProviderResolverService) {}

  /**
   * Busca na web via Tavily search API.
   * Default `searchDepth: 'advanced'` (decisao do produto: qualidade
   * vale mais que custo nesse caso, ja que search advanced custa
   * apenas 2 creditos por chamada).
   */
  async search(
    organizationId: string,
    query: string,
    profileId?: string,
    opts: SearchOpts = {}
  ): Promise<TavilySearchResponse> {
    const credential = await this._resolver.resolve(
      organizationId,
      'WEB_SEARCH',
      profileId
    );
    if (credential.provider === 'omni' || credential.options?.baseURL) {
      return this.customSearch(credential, query, opts);
    }
    if (credential.provider !== 'tavily') {
      throw new HttpException(
        `Provider sem suporte para web search: ${credential.provider}`,
        400
      );
    }

    const credOpts = (credential.options ?? {}) as WebSearchOptions;
    const searchDepth: 'basic' | 'advanced' =
      opts.searchDepth ?? credOpts.depth ?? 'advanced';
    const maxResults = opts.maxResults ?? credOpts.maxResults ?? 5;

    const client = tavily({ apiKey: credential.apiKey });

    try {
      const result = await this.withTimeout(
        client.search(query, {
          searchDepth,
          maxResults,
          topic: opts.topic ?? 'general',
          ...(opts.days ? { days: opts.days } : {}),
          includeAnswer: opts.includeAnswer ?? false,
        }),
        TAVILY_TIMEOUT_MS,
        'search'
      );
      this.logUsage('search', searchDepth, 1);
      return result;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logSanitized('search', e);
      throw new HttpException(
        `Tavily search falhou: ${
          (e as Error).message?.slice(0, 200) ?? 'erro desconhecido'
        }`,
        502
      );
    }
  }

  /**
   * Extrai conteudo limpo (markdown por default) de uma lista de URLs.
   * Default `extractDepth: 'basic'` — advanced custa 4 creditos por
   * batch de 5 URLs e raramente vale a pena (so para SPAs JS-heavy).
   * O composer expoe um toggle "Conteudo profundo" para o usuario
   * escolher advanced quando necessario.
   */
  async extract(
    organizationId: string,
    urls: string[],
    profileId?: string,
    opts: ExtractOpts = {}
  ): Promise<TavilyExtractResponse> {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new HttpException('urls obrigatorio (array nao vazio)', 400);
    }
    if (urls.length > MAX_EXTRACT_URLS) {
      throw new HttpException(
        `Limite de ${MAX_EXTRACT_URLS} URLs por chamada`,
        400
      );
    }
    for (const url of urls) {
      this.assertPublicUrl(url);
    }

    const credential = await this._resolver.resolve(
      organizationId,
      'WEB_SEARCH',
      profileId
    );
    if (credential.provider === 'omni' || credential.options?.baseURL) {
      return this.customExtract(credential, urls, opts);
    }
    if (credential.provider !== 'tavily') {
      throw new HttpException(
        `Provider sem suporte para web search: ${credential.provider}`,
        400
      );
    }

    const extractDepth: 'basic' | 'advanced' = opts.extractDepth ?? 'basic';
    const client = tavily({ apiKey: credential.apiKey });

    try {
      const result = await this.withTimeout(
        client.extract(urls, {
          extractDepth,
          format: opts.format ?? 'markdown',
          ...(opts.query ? { query: opts.query } : {}),
          timeout: Math.floor(TAVILY_TIMEOUT_MS / 1000),
        }),
        TAVILY_TIMEOUT_MS + 5_000,
        'extract'
      );
      this.logUsage('extract', extractDepth, urls.length);
      return result;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logSanitized('extract', e);
      throw new HttpException(
        `Tavily extract falhou: ${
          (e as Error).message?.slice(0, 200) ?? 'erro desconhecido'
        }`,
        502
      );
    }
  }

  private async customRequest(
    credential: ResolvedAiCredential,
    path: string,
    body: Record<string, unknown>
  ) {
    const baseURL = TextOptionsSchema.parse({
      baseURL: credential.options?.baseURL,
    }).baseURL;
    if (!baseURL) throw new HttpException('Configure a URL de busca web.', 412);
    try {
      const response = await ssrfSafeFetch(baseURL + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('Search provider unavailable');
      return await response.json();
    } catch {
      throw new HttpException(
        'Falha no provedor de busca. Confira URL, chave e opções.',
        412
      );
    }
  }

  private async customSearch(
    credential: ResolvedAiCredential,
    query: string,
    opts: SearchOpts
  ): Promise<TavilySearchResponse> {
    const options = (credential.options || {}) as WebSearchOptions;
    const omni = credential.provider === 'omni';
    if (!omni && credential.provider !== 'tavily')
      throw new HttpException('Protocolo de busca não suportado.', 400);
    const body = {
      query,
      max_results: opts.maxResults ?? options.maxResults ?? 5,
      ...(omni
        ? { provider: credential.model, search_type: 'web' }
        : {
            api_key: credential.apiKey,
            search_depth: opts.searchDepth ?? options.depth ?? 'advanced',
            include_answer: opts.includeAnswer ?? false,
            topic: opts.topic ?? 'general',
          }),
    };
    if (omni && !credential.model)
      throw new HttpException('Selecione o provedor de busca do Omni.', 412);
    const data = await this.customRequest(credential, '/search', body);
    if (!Array.isArray(data.results))
      throw new HttpException('Resposta de busca inválida.', 412);
    return {
      query,
      answer: typeof data.answer === 'string' ? data.answer : '',
      images: [],
      responseTime: 0,
      requestId: typeof data.id === 'string' ? data.id : '',
      results: data.results
        .slice(0, 20)
        .filter((item: any) => typeof item?.url === 'string')
        .map((item: any) => ({
          title: typeof item.title === 'string' ? item.title : '',
          url: item.url,
          content:
            typeof item.content === 'string'
              ? item.content
              : typeof item.snippet === 'string'
              ? item.snippet
              : '',
          score: typeof item.score === 'number' ? item.score : 0,
          rawContent:
            typeof item.raw_content === 'string' ? item.raw_content : undefined,
        })),
    } as TavilySearchResponse;
  }

  private async customExtract(
    credential: ResolvedAiCredential,
    urls: string[],
    opts: ExtractOpts
  ): Promise<TavilyExtractResponse> {
    for (const url of urls)
      if (!(await isSafePublicHttpsUrl(url)))
        throw new HttpException('URL de extração não permitida.', 400);
    const options = (credential.options || {}) as WebSearchOptions;
    if (credential.provider === 'tavily') {
      const data = await this.customRequest(credential, '/extract', {
        api_key: credential.apiKey,
        urls,
        extract_depth: opts.extractDepth || 'basic',
        format: opts.format || 'markdown',
      });
      return {
        responseTime: 0,
        results: (data.results || []).map((item: any) => ({
          url: item.url,
          rawContent: item.raw_content || item.rawContent || '',
        })),
        failedResults: data.failed_results || [],
      } as TavilyExtractResponse;
    }
    if (credential.provider !== 'omni')
      throw new HttpException('Protocolo de extração não suportado.', 400);
    const provider =
      options.fetchProvider ||
      (['firecrawl', 'jina-reader', 'tavily-search', 'tinyfish'].includes(
        credential.model || ''
      )
        ? credential.model
        : undefined);
    if (!provider)
      throw new HttpException(
        'Selecione em Modelos de IA um provedor de extração de links para o Omni.',
        412
      );
    const results = [];
    for (const url of urls) {
      const data = await this.customRequest(credential, '/web/fetch', {
        url,
        provider,
        format: 'markdown',
        depth: opts.extractDepth === 'advanced' ? 1 : 0,
      });
      if (typeof data.content !== 'string')
        throw new HttpException('Resposta de extração inválida.', 412);
      results.push({ url, rawContent: data.content });
    }
    return {
      results,
      failedResults: [],
      responseTime: 0,
    } as TavilyExtractResponse;
  }

  // ---------------- helpers internos ----------------

  /**
   * Valida que `raw` e uma URL publica http/https. Bloqueia
   * `file://`, `javascript:`, `data:`, etc., e ranges privados/local.
   */
  private assertPublicUrl(raw: string): void {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new HttpException(`URL invalida: ${raw.slice(0, 80)}`, 400);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpException(`Protocolo nao aceito: ${parsed.protocol}`, 400);
    }
    const host = parsed.hostname;
    for (const pattern of PRIVATE_HOST_PATTERNS) {
      if (pattern.test(host)) {
        throw new HttpException(`Host privado nao aceito: ${host}`, 400);
      }
    }
  }

  /**
   * Promise.race com timeout. Tavily tem `timeout` proprio no extract
   * (segundos), mas o search nao expoe — esse wrapper garante que
   * nenhuma chamada fica pendurada por mais que TAVILY_TIMEOUT_MS.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    operation: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new HttpException(`Tavily ${operation} excedeu ${ms}ms`, 504));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Log estruturado de uso. Util para debugar custo (cada chamada
   * ao Tavily aparece com depth e count para o admin estimar gasto).
   */
  private logUsage(
    operation: 'search' | 'extract',
    depth: 'basic' | 'advanced',
    count: number
  ): void {
    const credits =
      operation === 'search'
        ? depth === 'advanced'
          ? 2
          : 1
        : Math.ceil(count / 5) * (depth === 'advanced' ? 4 : 2);
    this._logger.log(
      `Tavily ${operation} ok depth=${depth} count=${count} credits=${credits}`
    );
  }

  /**
   * Sanitiza qualquer mensagem de erro antes de logar — Tavily as
   * vezes echoa o api key em respostas 401/403.
   */
  private logSanitized(operation: string, error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error);
    const sanitized = raw
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer ***')
      .replace(/tvly-[A-Za-z0-9._\-]+/g, 'tvly-***')
      .slice(0, 300);
    this._logger.warn(`Tavily ${operation} falhou: ${sanitized}`);
  }
}
