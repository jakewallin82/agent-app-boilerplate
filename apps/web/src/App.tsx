import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { FileProvider } from '@/contexts/FileContext';
import { DevModeProvider } from '@/contexts/DevModeContext';
import { AuthPage } from '@/components/AuthPage';
import { ChatInterface } from '@/components/ChatInterface';
import { Layout } from '@/components/Layout';

function AppContent() {
  return (
    // SessionProvider must be inside Route to access useParams
    <SessionProvider>
      <FileProvider>
        <Layout>
          <ChatInterface />
        </Layout>
      </FileProvider>
    </SessionProvider>
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
    <DevModeProvider>
      <Routes>
        {/* Route with optional session name parameter */}
        <Route path="/:sessionName?" element={<AppContent />} />
      </Routes>
    </DevModeProvider>
  );
}
