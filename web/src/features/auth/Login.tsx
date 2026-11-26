import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { brand } from '../../config/brand';
import { toggleLanguage } from '../../i18n';
import { supabase } from '../../lib/supabase';

export function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (e) setError(e.message);
  };

  const magicLink = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (e) setError(e.message);
    else setSent(true);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <img src="/icons/icon-192.png" alt="" className="mx-auto mb-4 h-16 w-16 rounded-2xl" />
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <p className="mt-1 text-slate-600">{t('signInTitle')}</p>
      </div>

      <button
        onClick={() => void google()}
        className="min-h-12 rounded-xl border border-slate-300 px-4 font-medium active:bg-slate-100"
      >
        {t('google')}
      </button>

      <form onSubmit={(e) => void magicLink(e)} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          className="min-h-12 rounded-xl border border-slate-300 px-4"
          autoComplete="email"
        />
        <button className="min-h-12 rounded-xl bg-brand px-4 font-medium text-white active:bg-brand-dark">
          {t('sendLink')}
        </button>
      </form>

      {sent && <p className="text-center text-sm text-emerald-700">{t('linkSent')}</p>}
      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button onClick={toggleLanguage} className="min-h-11 text-sm text-slate-500 underline">
        {t('language')}
      </button>

      <p className="text-center text-xs text-slate-500">
        {t('agree')}{' '}
        <Link to="/terms" className="underline">
          {t('terms')}
        </Link>{' '}
        ·{' '}
        <Link to="/privacy" className="underline">
          {t('privacy')}
        </Link>
      </p>
    </main>
  );
}
