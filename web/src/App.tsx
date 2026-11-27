import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { Login } from './features/auth/Login';
import { useSession } from './features/auth/useSession';
import { SharePage } from './features/capture/SharePage';
import { Privacy, Terms } from './features/legal/Legal';
import { JoinPage, PENDING_INVITE_KEY } from './features/plan/JoinPage';
import { PlanPage } from './features/plan/PlanPage';
import { BillDetail } from './features/review/BillDetail';
import { Home } from './features/vault/Home';
import { Vendors } from './features/vendors/Vendors';
import { Spinner } from './features/vault/ui';
import { isConfigured } from './lib/env';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public pages (linked from Google sign-in and the login screen) */}
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<SignedIn />} />
      </Routes>
    </BrowserRouter>
  );
}

function SignedIn() {
  const { t } = useTranslation();
  const { session, loading } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  // Invite links must survive the sign-in redirect (OAuth returns to "/").
  useEffect(() => {
    const m = location.pathname.match(/^\/join\/([\w-]+)$/);
    try {
      if (m && !session) localStorage.setItem(PENDING_INVITE_KEY, m[1]!);
      const pending = localStorage.getItem(PENDING_INVITE_KEY);
      if (session && pending && !m) navigate(`/join/${pending}`, { replace: true });
    } catch {
      // storage unavailable
    }
  }, [location.pathname, session, navigate]);

  if (!isConfigured) {
    return <p className="m-6 rounded-xl bg-amber-50 p-4 text-amber-900">{t('setup')}</p>;
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!session) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/bill/:id" element={<BillDetail />} />
      <Route path="/share" element={<SharePage />} />
      <Route path="/vendors" element={<Vendors />} />
      <Route path="/plan" element={<PlanPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
