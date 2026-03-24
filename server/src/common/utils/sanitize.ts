/**
 * Sanitizes user input before injecting into AI prompts.
 * Prevents common prompt injection patterns.
 */
export function sanitizeForPrompt(input: string): string {
  let sanitized = input;

  // Remove instruction override patterns
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    /override\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    /you\s+are\s+now\s+/gi,
    /act\s+as\s+(if\s+)?(you\s+are\s+)?/gi,
    /new\s+instructions?:/gi,
    /system\s*prompt:/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\/?system>/gi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  }

  // Limit length to prevent context-window abuse
  const MAX_LENGTH = 5000;
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH) + '... [truncated]';
  }

  return sanitized;
}
