export const STRUCTURED_BODY_LIMIT = process.env.STRUCTURED_BODY_LIMIT || '256kb';

export function structuredJsonParserOptions() {
  return { limit: STRUCTURED_BODY_LIMIT };
}

export function structuredUrlEncodedParserOptions() {
  return { extended: true, limit: STRUCTURED_BODY_LIMIT };
}
