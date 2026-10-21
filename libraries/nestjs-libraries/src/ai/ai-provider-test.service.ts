import { ssrfSafeFetch } from '../dtos/webhooks/ssrf.safe.dispatcher';
import { TextOptionsSchema } from './ai-credential.schemas';
import { AiKind } from '@prisma/client';
import { Injectable } from '@nestjs/common';

export interface AiProviderTestResult {
  ok: boolean;
  error?: string;
}

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

@Injectable()
export class AiProviderTestService {
  async test(
    provider: string,
    apiKey: string,
    baseURL?: string,
    kind: AiKind = 'TEXT'
  ): Promise<AiProviderTestResult> {
    if (!apiKey) {
      return { ok: false, error: 'API key vazia.' };
    }

    try {
      switch (provider) {
        case 'openrouter':
          return baseURL
            ? await this.testOpenAi(apiKey, baseURL)
            : await this.testOpenRouter(apiKey);
        case 'openai':
        case 'openai-compatible':
          return await this.testOpenAi(apiKey, baseURL);
        case 'omni':
          return await this.testOmni(apiKey, baseURL, kind);
        case 'tavily':
          return baseURL
            ? await this.testTavily(apiKey, baseURL)
            : await this.testTavily(apiKey);
        case 'kieai':
          if (baseURL)
            return {
              ok: false,
              error:
                'Teste a geração com um modelo KieAI configurado; essa API não oferece verificação gratuita de chave.',
            };
          // KieAI nao expoe endpoint de validacao publico — aceitamos a chave
          // como valida na hora do save, falhas reais aparecem na primeira
          // geracao real.
          return { ok: true };
        default:
          return {
            ok: false,
            error: `Provider desconhecido: ${provider}`,
          };
      }
    } catch (e: any) {
      return {
        ok: false,
        error: 'Não foi possível conectar ao provedor. Confira URL e chave.',
      };
    }
  }

  private async testOmni(
    apiKey: string,
    baseURL: string | undefined,
    kind: AiKind
  ): Promise<AiProviderTestResult> {
    const base = TextOptionsSchema.parse({ baseURL }).baseURL;
    if (!base) return { ok: false, error: 'Informe a URL base.' };
    const path =
      kind === 'WEB_SEARCH'
        ? '/search'
        : kind === 'VIDEO'
        ? '/videos/generations'
        : '/models';
    const result = await ssrfSafeFetch(base + path, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    return result.ok
      ? { ok: true }
      : { ok: false, error: `Provedor retornou HTTP ${result.status}.` };
  }

  private async testOpenRouter(apiKey: string): Promise<AiProviderTestResult> {
    const res = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `OpenRouter retornou ${res.status}.`,
      };
    }
    return { ok: true };
  }

  private async testOpenAi(
    apiKey: string,
    baseURL?: string
  ): Promise<AiProviderTestResult> {
    const url = baseURL
      ? TextOptionsSchema.parse({ baseURL }).baseURL + '/models'
      : OPENAI_MODELS_URL;
    const res = await ssrfSafeFetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `OpenAI retornou ${res.status}.`,
      };
    }
    return { ok: true };
  }

  private async testTavily(
    apiKey: string,
    baseURL?: string
  ): Promise<AiProviderTestResult> {
    // Tavily nao tem endpoint dedicado de validacao; usamos uma busca trivial.
    const res = await ssrfSafeFetch(
      baseURL
        ? TextOptionsSchema.parse({ baseURL }).baseURL + '/search'
        : TAVILY_SEARCH_URL,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: 'ping',
          max_results: 1,
        }),
      }
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `Tavily retornou ${res.status}.`,
      };
    }
    return { ok: true };
  }
}
