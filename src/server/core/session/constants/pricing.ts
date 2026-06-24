/**
 * Anthropic Claude API Pricing Information
 * Last updated: 2026-06-24
 *
 * Prices are in USD per million tokens (MTok)
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 */

export type ModelName =
  | "claude-fable-5"
  | "claude-mythos-5"
  | "claude-opus-4.8"
  | "claude-opus-4.7"
  | "claude-opus-4.6"
  | "claude-opus-4.5"
  | "claude-opus-4.1"
  | "claude-sonnet-4.6"
  | "claude-sonnet-4.5"
  | "claude-3.5-sonnet"
  | "claude-haiku-4.5"
  | "claude-haiku-3.5"
  | "claude-3-opus"
  | "claude-3-haiku";

export type TokenType = "input" | "output" | "cache_creation" | "cache_read";

export type ModelPricing = {
  readonly input: number;
  readonly output: number;
  readonly cache_creation: number;
  readonly cache_read: number;
};

/**
 * Pricing per million tokens (MTok) in USD
 *
 * cache_creation uses the 5-minute cache write rate from Anthropic docs.
 * 1-hour cache writes (2x base input) are not split out yet.
 *
 * Note: Claude Sonnet 4.5/4.6 has tiered pricing based on prompt length:
 * - ≤200K tokens: $3/$15 (standard tier, used here)
 * - >200K tokens: $6/$22.50 (extended context tier, not implemented)
 */
export const MODEL_PRICING: Record<ModelName, ModelPricing> = {
  "claude-fable-5": {
    input: 10.0,
    output: 50.0,
    cache_creation: 12.5,
    cache_read: 1.0,
  },
  "claude-mythos-5": {
    input: 10.0,
    output: 50.0,
    cache_creation: 12.5,
    cache_read: 1.0,
  },
  "claude-opus-4.8": {
    input: 5.0,
    output: 25.0,
    cache_creation: 6.25,
    cache_read: 0.5,
  },
  "claude-opus-4.7": {
    input: 5.0,
    output: 25.0,
    cache_creation: 6.25,
    cache_read: 0.5,
  },
  "claude-opus-4.6": {
    input: 5.0,
    output: 25.0,
    cache_creation: 6.25,
    cache_read: 0.5,
  },
  "claude-opus-4.5": {
    input: 5.0,
    output: 25.0,
    cache_creation: 6.25,
    cache_read: 0.5,
  },
  "claude-opus-4.1": {
    input: 15.0,
    output: 75.0,
    cache_creation: 18.75,
    cache_read: 1.5,
  },
  "claude-sonnet-4.6": {
    input: 3.0,
    output: 15.0,
    cache_creation: 3.75,
    cache_read: 0.3,
  },
  "claude-sonnet-4.5": {
    input: 3.0,
    output: 15.0,
    cache_creation: 3.75,
    cache_read: 0.3,
  },
  "claude-3.5-sonnet": {
    input: 3.0,
    output: 15.0,
    cache_creation: 3.75,
    cache_read: 0.3,
  },
  "claude-haiku-4.5": {
    input: 1.0,
    output: 5.0,
    cache_creation: 1.25,
    cache_read: 0.1,
  },
  "claude-haiku-3.5": {
    input: 0.8,
    output: 4.0,
    cache_creation: 1.0,
    cache_read: 0.08,
  },
  "claude-3-opus": {
    input: 15.0,
    output: 75.0,
    cache_creation: 18.75,
    cache_read: 1.5,
  },
  "claude-3-haiku": {
    input: 0.25,
    output: 1.25,
    cache_creation: 0.3,
    cache_read: 0.03,
  },
} as const;

/**
 * Default pricing for unknown models
 * Uses Claude 3.5 Sonnet pricing as a safe default
 */
export const DEFAULT_MODEL_PRICING: ModelPricing = MODEL_PRICING["claude-3.5-sonnet"];
