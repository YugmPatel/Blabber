import type { ReactNode } from 'react';
import Sidebar, { type SidebarProps } from '@/components/Sidebar';

interface AppShellProps extends SidebarProps {
  children: ReactNode;
  /** Adds a very subtle ambient radial glow behind the content in dark mode. Off by default. */
  ambient?: boolean;
  mainClassName?: string;
}

/**
 * The standard page frame (Sidebar + scrollable main column) most screens
 * already hand-roll inline. New/updated pages can adopt this directly;
 * existing pages keep working exactly as-is until they're migrated.
 */
export default function AppShell({ children, ambient = false, mainClassName = '', ...sidebarProps }: AppShellProps) {
  return (
    <div className="flex h-screen bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <Sidebar {...sidebarProps} />
      <main className={`relative min-w-0 flex-1 overflow-y-auto bg-[color:var(--bl-bg)] ${mainClassName}`.trim()}>
        {ambient && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 hidden h-72 dark:block"
            style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(19,200,177,0.12) 0%, rgba(19,200,177,0) 70%)' }}
          />
        )}
        <div className="relative">{children}</div>
      </main>
    </div>
  );
}
