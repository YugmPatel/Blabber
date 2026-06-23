import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChatsLayout from './pages/ChatsLayout';
import ChatView from './pages/ChatView';
import SettingsPage from './pages/SettingsPage';
import StatusPage from './pages/StatusPage';
import CallsPage from './pages/CallsPage';
import MyActionsPage from './pages/MyActionsPage';

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
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
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
  {
    path: '/calls',
    element: (
      <ProtectedRoute>
        <CallsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/actions',
    element: (
      <ProtectedRoute>
        <MyActionsPage />
      </ProtectedRoute>
    ),
  },
]);
