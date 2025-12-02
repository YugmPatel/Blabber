import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// Create a new QueryClient for each test to ensure isolation
export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

// Wrapper component for testing hooks
export const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Helper to render hook with QueryClient
export const renderQueryHook = <TResult, TProps>(
  hook: (props: TProps) => TResult,
  props?: TProps
) => {
  const queryClient = createTestQueryClient();
  const wrapper = createWrapper(queryClient);

  return {
    ...renderHook(() => hook(props as TProps), { wrapper }),
    queryClient,
  };
};

// Export waitFor for convenience
export { waitFor };
