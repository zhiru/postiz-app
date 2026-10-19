import { AiKind } from '@prisma/client';

export interface CatalogModelPricing {
  promptUSDPerMillion?: number;
  completionUSDPerMillion?: number;
  imageUSDPerImage?: number;
}

export interface CatalogImageConfig {
  aspectRatios?: string[];
  sizes?: string[];
}

export interface CatalogModel {
  id: string;
  displayName: string;
  provider: string;
  kind: AiKind;
  reasoning?: { supported: boolean; efforts: string[]; preset?: string };
  contextLength?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  imageConfig?: CatalogImageConfig;
  pricing?: CatalogModelPricing;
}

export interface CatalogResponse {
  provider: string;
  kind: AiKind;
  fetchedAt: string;
  models: CatalogModel[];
}
