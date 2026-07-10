import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { AuthProvider } from './contexts/AuthContext';
import { VeyraSessionProvider } from './contexts/VeyraSessionContext';
import { SocketProvider } from './socket';
import { queryClient } from './lib/query-client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastContainer';

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SocketProvider>
            <VeyraSessionProvider>
              <ToastProvider>
                <RouterProvider router={router} />
              </ToastProvider>
            </VeyraSessionProvider>
          </SocketProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
