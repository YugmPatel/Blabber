import { useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function ChatsLayout() {
  const [showSidebar, setShowSidebar] = useState(true);
  const { id } = useParams();

  // On mobile, hide sidebar when a chat is selected
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const shouldShowSidebar = !isMobile || !id || showSidebar;

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-100 overflow-hidden">
        {/* Sidebar - hidden on mobile when chat is open */}
        <div className={`${shouldShowSidebar ? 'block' : 'hidden'} md:block w-full md:w-auto`}>
          <Sidebar onMenuClick={() => setShowSidebar(false)} />
        </div>

        {/* Main content - full width on mobile, flex-1 on desktop */}
        <div className={`${!shouldShowSidebar || !isMobile ? 'flex-1' : 'hidden'} md:flex-1`}>
          <Outlet />
        </div>
      </div>
    </ErrorBoundary>
  );
}
