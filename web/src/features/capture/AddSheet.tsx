import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Source } from '../../lib/db';

interface Props {
  busy: boolean;
  onFiles(files: File[], source: Source): void;
}

/** Floating + button. Tap = camera straight away; long list of options only on the sheet. */
export function AddSheet({ busy, onFiles }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);

  const pick = (source: Source) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow picking the same file again
    setOpen(false);
    onFiles(files, source);
  };

  return (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick('camera')} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={pick('gallery')} />
      <input ref={pdf} type="file" accept="application/pdf" multiple hidden onChange={pick('pdf')} />

      {open && (
        <div className="fixed inset-0 z-20 bg-black/30" onClick={() => setOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col gap-2 rounded-t-2xl bg-white p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <SheetButton label={t('camera')} icon="📷" onClick={() => camera.current?.click()} />
            <SheetButton label={t('gallery')} icon="🖼️" onClick={() => gallery.current?.click()} />
            <SheetButton label={t('pdf')} icon="📄" onClick={() => pdf.current?.click()} />
          </div>
        </div>
      )}

      <div className="fixed right-5 bottom-6 z-10 flex items-center gap-2">
        <button
          aria-label={t('more')}
          onClick={() => setOpen(true)}
          className="h-12 w-12 rounded-full bg-white text-xl shadow-lg ring-1 ring-slate-200 active:bg-slate-100"
        >
          ⋯
        </button>
        <button
          aria-label={t('add')}
          disabled={busy}
          onClick={() => camera.current?.click()}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-4xl text-white shadow-xl active:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" /> : '+'}
        </button>
      </div>
    </>
  );
}

function SheetButton({ label, icon, onClick }: { label: string; icon: string; onClick(): void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-xl px-4 text-left text-lg active:bg-slate-100"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}
