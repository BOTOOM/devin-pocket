import { useEffect } from 'react';
import { AgentGate } from '@/components/AgentGate';
import { ChatScreen } from '@/components/Chat';
import { DiagnosticsScreen } from '@/components/Diagnostics';
import { DesktopWelcome, HomeScreen, SessionList } from '@/components/Home';
import { PairScreen } from '@/components/PairScreen';
import { SettingsScreen } from '@/components/Settings';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import { initAuth, refreshAuth, useAuth } from '@/lib/auth';
import { useRoute } from '@/lib/router';
import { useDesktop } from '@/lib/use-desktop';
import { stopSocket } from '@/lib/ws';
import { initStore, useStore } from '@/store';

export function App() {
  const t = useT();
  const auth = useAuth();
  const route = useRoute();
  const connected = useStore((s) => s.connected);
  const agent = useStore((s) => s.agent);
  const desktop = useDesktop();

  useEffect(() => {
    void initAuth();
  }, []);
  useEffect(() => {
    if (auth.phase !== 'ready') return;
    initStore(refreshAuth);
    return stopSocket;
  }, [auth.phase]);

  if (auth.phase !== 'ready') return <PairScreen />;

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
          {/* Full-width pane: each screen centers its own column (.pane-chat/.pane-page)
              so scroll regions reach the edges instead of sitting inside the margin. */}
          <div data-testid="main-pane" className="flex min-h-0 min-w-0 flex-1 flex-col">
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
