/**
 * AI Provider Abstract Class (Adapter Pattern)
 *
 * All AI providers (Gemini, OpenAI, etc.) must extend this class.
 * Using abstract class instead of interface to support
 * emitDecoratorMetadata + isolatedModules in TypeScript.
 */
export abstract class AiProvider {
  /**
   * Generate text content from a prompt.
   */
  abstract generateContent(prompt: string): Promise<string>;

  /**
   * Get the provider's display name (for logging).
   */
  abstract getName(): string;

  /**
   * Check if the provider is properly configured and ready.
   */
  abstract isAvailable(): boolean;
}

/**
 * Injection token for the AI provider.
 */
export const AI_PROVIDER = 'AI_PROVIDER';
export const AI_PROVIDERS = 'AI_PROVIDERS';
