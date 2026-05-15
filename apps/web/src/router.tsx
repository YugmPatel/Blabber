import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatsLayout from './pages/ChatsLayout';
import ChatView from './pages/ChatView';
import SettingsPage from './pages/SettingsPage';
import StatusPage from './pages/StatusPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/chats" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/chats',
    element: (
      <ProtectedRoute>
        <ChatsLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: ':id',
        element: <ChatView />,
      },
    ],
  },
  {
    path: '/profile',
    element: <Navigate to="/settings?s=profile" replace />,
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <SettingsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/status',
    element: (
      <ProtectedRoute>
        <StatusPage />
      </ProtectedRoute>
    ),
  },
]);
