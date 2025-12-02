// Type definitions for React Query InfiniteData
// Workaround for import issues

export interface InfiniteData<TData> {
  pages: TData[];
  pageParams: unknown[];
}
