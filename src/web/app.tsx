import { useEffect } from 'react';
import { AgentGate } from '@/components/AgentGate';
import { ChatScreen } from '@/components/Chat';
import { DiagnosticsScreen } from '@/components/Diagnostics';
import { HomeScreen } from '@/components/Home';
import { SettingsScreen } from '@/components/Settings';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import { useRoute } from '@/lib/router';
import { initStore, useStore } from '@/store';

export function App() {
  const t = useT();
  const route = useRoute();
  const connected = useStore((s) => s.connected);
  const agent = useStore((s) => s.agent);

  useEffect(() => initStore(), []);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col bg-background">
        {!connected && (
          <div className="safe-top bg-warning/20 px-4 py-1.5 text-center text-xs font-medium text-warning-foreground dark:text-warning">
            {t('conn.reconnecting')}
          </div>
        )}
        {route.name === 'home' && <HomeScreen />}
        {route.name === 'chat' && <ChatScreen sessionId={route.sessionId} />}
        {route.name === 'settings' && <SettingsScreen />}
        {route.name === 'diagnostics' && <DiagnosticsScreen />}
        <AgentGate status={agent} />
      </div>
      <Toaster position="top-center" richColors={false} closeButton />
    </TooltipProvider>
  );
}
