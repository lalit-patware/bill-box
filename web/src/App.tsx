import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Login } from './features/auth/Login';
import { useSession } from './features/auth/useSession';
import { SharePage } from './features/capture/SharePage';
import { Home } from './features/vault/Home';
import { isConfigured } from './lib/env';

export function App() {
  const { t } = useTranslation();
  const { session, loading } = useSession();

  if (!isConfigured) {
    return <p className="m-6 rounded-xl bg-amber-50 p-4 text-amber-900">{t('setup')}</p>;
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }
  if (!session) return <Login />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
