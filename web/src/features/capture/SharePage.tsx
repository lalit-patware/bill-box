import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { db } from '../../lib/db';
import { prepareFiles } from './prepare';
import { enqueue, processQueue } from './queue';
import { supabaseDeps } from './supabaseDeps';

/** Landing page after "Share → Bill Box" from WhatsApp/Gallery (files saved by the SW). */
export function SharePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [none, setNone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const shared = await db.shared.toArray();
      if (!shared.length) {
        setNone(true);
        return;
      }
      const files = shared.map((s) => new File([s.file], s.name, { type: s.type }));
      const out = await prepareFiles(files, 'share');
      if (out.bills.length) await enqueue(out.bills);
      await db.shared.bulkDelete(shared.map((s) => s.id!));
      void processQueue(supabaseDeps);
      navigate('/', { replace: true });
    })();
  }, [navigate]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      {none ? (
        <>
          <p>{t('shareNone')}</p>
          <button className="min-h-12 rounded-xl bg-brand px-6 text-white" onClick={() => navigate('/')}>
            OK
          </button>
        </>
      ) : (
        <>
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p>{t('shareTitle')}</p>
        </>
      )}
    </main>
  );
}
