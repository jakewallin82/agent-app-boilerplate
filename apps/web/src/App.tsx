import { useAuth } from '@/contexts/AuthContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { FileProvider } from '@/contexts/FileContext';
import { AuthPage } from '@/components/AuthPage';
import { ChatInterface } from '@/components/ChatInterface';
import { Layout } from '@/components/Layout';

function AppContent() {
  return (
    <Layout>
      <ChatInterface />
    </Layout>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <SessionProvider>
      <FileProvider>
        <AppContent />
      </FileProvider>
    </SessionProvider>
  );
}
