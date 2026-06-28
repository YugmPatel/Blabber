import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChatsLayout from './pages/ChatsLayout';
import ChatView from './pages/ChatView';
import SettingsPage from './pages/SettingsPage';
import MomentsPage from './pages/MomentsPage';
import CallsPage from './pages/CallsPage';
import MyActionsPage from './pages/MyActionsPage';
import MessageSearchPage from './pages/MessageSearchPage';
import ArchivedChatsPage from './pages/ArchivedChatsPage';
import SavedMessagesPage from './pages/SavedMessagesPage';
import JoinInvitePage from './pages/JoinInvitePage';
import SocialProfilePage from './pages/SocialProfilePage';

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
    path: '/join/:token',
    element: <JoinInvitePage />,
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
    path: '/p/:handle',
    element: (
      <ProtectedRoute>
        <SocialProfilePage />
      </ProtectedRoute>
    ),
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
    element: <Navigate to="/moments" replace />,
  },
  {
    path: '/moments',
    element: (
      <ProtectedRoute>
        <MomentsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/moments/archive',
    element: (
      <ProtectedRoute>
        <MomentsPage />
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
    path: '/archived',
    element: (
      <ProtectedRoute>
        <ArchivedChatsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/saved',
    element: (
      <ProtectedRoute>
        <SavedMessagesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/search',
    element: (
      <ProtectedRoute>
        <MessageSearchPage />
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
