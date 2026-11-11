import { useEffect, useSyncExternalStore } from 'react';
import { AgentGate } from '@/components/AgentGate';
import { ChatScreen } from '@/components/Chat';
import { DiagnosticsScreen } from '@/components/Diagnostics';
import { DesktopWelcome, HomeScreen, SessionList } from '@/components/Home';
import { SettingsScreen } from '@/components/Settings';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import { useRoute } from '@/lib/router';
import { initStore, useStore } from '@/store';

const desktopQuery = matchMedia('(min-width: 1024px)');
const subscribeDesktop = (notify: () => void) => {
  desktopQuery.addEventListener('change', notify);
  return () => desktopQuery.removeEventListener('change', notify);
};

export function App() {
  const t = useT();
  const route = useRoute();
  const connected = useStore((s) => s.connected);
  const agent = useStore((s) => s.agent);
  const desktop = useSyncExternalStore(subscribeDesktop, () => desktopQuery.matches);

  useEffect(() => initStore(), []);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col bg-background lg:max-w-none">
        {!connected && (
          <div className="safe-top bg-warning/20 px-4 py-1.5 text-center text-xs font-medium text-warning">
            {t('conn.reconnecting')}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {desktop && (
            <aside
              data-testid="session-sidebar"
              aria-label={t('home.sessions')}
              className="flex w-80 shrink-0 flex-col border-r"
            >
              <SessionList currentSessionId={route.name === 'chat' ? route.sessionId : undefined} />
            </aside>
          )}
          <div
            data-testid="main-pane"
            className={`flex min-h-0 min-w-0 flex-1 flex-col ${route.name === 'chat' ? 'lg:mx-auto lg:max-w-[860px]' : 'lg:mx-auto lg:max-w-[1100px]'}`}
          >
            {route.name === 'home' && (desktop ? <DesktopWelcome /> : <HomeScreen />)}
            {route.name === 'chat' && (
              <ChatScreen key={route.sessionId} sessionId={route.sessionId} />
            )}
            {route.name === 'settings' && <SettingsScreen />}
            {route.name === 'diagnostics' && <DiagnosticsScreen />}
          </div>
        </div>
        <AgentGate status={agent} />
      </div>
      <Toaster position="top-center" richColors={false} closeButton />
    </TooltipProvider>
  );
}
