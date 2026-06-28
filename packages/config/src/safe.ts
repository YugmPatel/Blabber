import { z } from 'zod';

export interface SafeConfigErrorDetail {
  path: string;
  message: string;
}

export class SafeConfigError extends Error {
  constructor(
    public readonly scope: string,
    public readonly details: SafeConfigErrorDetail[]
  ) {
    super(`${scope} configuration is invalid: ${details.map((detail) => detail.path).join(', ')}`);
    this.name = 'SafeConfigError';
  }
}

export function formatZodErrors(error: z.ZodError): SafeConfigErrorDetail[] {
  return error.errors.map((issue) => ({
    path: issue.path.join('.') || 'config',
    message: issue.message,
  }));
}

export function throwConfigError(scope: string, details: SafeConfigErrorDetail[]): never {
  throw new SafeConfigError(scope, details);
}

export function requireSafeParse<T>(scope: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throwConfigError(scope, formatZodErrors(result.error));
  }
  return result.data;
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function isTest() {
  return process.env.NODE_ENV === 'test';
}

export function isTestDatabaseName(name: string) {
  const normalized = name.toLowerCase();
  return normalized.startsWith('test_') || normalized.endsWith('_test') || normalized.includes('_test_');
}

export function assertSafeTestDatabase(uri: string, dbName: string) {
  if (!isTestDatabaseName(dbName)) {
    throwConfigError('test database', [
      {
        path: 'MONGO_DB_NAME',
        message: 'Test database name must be clearly test-scoped',
      },
    ]);
  }

  const lowered = `${uri}/${dbName}`.toLowerCase();
  const unsafeMarkers = ['prod', 'production', 'blabber_full', 'whatsapp', 'chat_db'];
  if (unsafeMarkers.some((marker) => lowered.includes(marker)) && !lowered.includes('test')) {
    throwConfigError('test database', [
      {
        path: 'MONGO_URI',
        message: 'Test mode cannot target production-like database names or hosts',
      },
    ]);
  }
}
