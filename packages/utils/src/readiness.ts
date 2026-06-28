export type ReadinessStatus = 'ok' | 'error' | 'timeout';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
  timeoutMs?: number;
}

export async function runReadinessChecks(checks: ReadinessCheck[]) {
  const results = await Promise.all(
    checks.map(async ({ name, check, timeoutMs = 1000 }) => {
      try {
        await Promise.race([
          check(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), timeoutMs);
          }),
        ]);
        return { name, status: 'ok' as ReadinessStatus };
      } catch (error) {
        return {
          name,
          status: error instanceof Error && error.message === 'timeout' ? 'timeout' as const : 'error' as const,
        };
      }
    })
  );

  return {
    ready: results.every((result) => result.status === 'ok'),
    checks: results,
  };
}
