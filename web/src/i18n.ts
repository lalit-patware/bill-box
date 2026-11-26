import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  add: 'Add bill',
  camera: 'Take photo',
  gallery: 'From gallery',
  pdf: 'PDF',
  recent: 'Recent bills',
  empty: 'No bills yet. Tap + and snap your first bill.',
  processing: 'Reading…',
  failed: "Couldn't read",
  done: 'Saved',
  queued: '{{count}} waiting to upload',
  offline: "You're offline. Bills will upload when you're back online.",
  blurry: 'Photo looks blurry. Retake?',
  retake: 'Retake',
  useAnyway: 'Use anyway',
  skipped: "Couldn't use: {{names}}",
  signInTitle: 'Keep every bill safe',
  google: 'Continue with Google',
  emailPlaceholder: 'you@example.com',
  sendLink: 'Email me a sign-in link',
  linkSent: 'Check your email for the sign-in link.',
  signOut: 'Sign out',
  shareTitle: 'Saving shared bills',
  shareNone: 'Nothing was shared. Try sharing an image or PDF again.',
  setup: 'Setup needed: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to web/.env',
  language: 'हिंदी',
  more: 'More ways to add',
  savedPending: 'Bill saved',
  detailsSoon: 'Details soon',
  loadError: "Couldn't load bills. Check your connection.",
};

const hi: typeof en = {
  add: 'बिल जोड़ें',
  camera: 'फ़ोटो लें',
  gallery: 'गैलरी से',
  pdf: 'PDF',
  recent: 'हाल के बिल',
  empty: 'अभी कोई बिल नहीं। + दबाएँ और पहला बिल क्लिक करें।',
  processing: 'पढ़ रहे हैं…',
  failed: 'पढ़ नहीं पाए',
  done: 'सेव हो गया',
  queued: '{{count}} अपलोड की प्रतीक्षा में',
  offline: 'आप ऑफ़लाइन हैं। इंटरनेट आने पर बिल अपलोड हो जाएँगे।',
  blurry: 'फ़ोटो धुंधली है। दोबारा लें?',
  retake: 'दोबारा लें',
  useAnyway: 'फिर भी इस्तेमाल करें',
  skipped: 'इस्तेमाल नहीं कर पाए: {{names}}',
  signInTitle: 'हर बिल सुरक्षित रखें',
  google: 'Google से जारी रखें',
  emailPlaceholder: 'you@example.com',
  sendLink: 'ईमेल पर साइन-इन लिंक भेजें',
  linkSent: 'साइन-इन लिंक के लिए ईमेल देखें।',
  signOut: 'साइन आउट',
  shareTitle: 'शेयर किए गए बिल सेव हो रहे हैं',
  shareNone: 'कुछ शेयर नहीं हुआ। फ़ोटो या PDF फिर से शेयर करें।',
  setup: 'सेटअप ज़रूरी: web/.env में VITE_SUPABASE_URL और VITE_SUPABASE_ANON_KEY जोड़ें',
  language: 'English',
  more: 'जोड़ने के और तरीके',
  savedPending: 'बिल सेव हो गया',
  detailsSoon: 'जानकारी जल्द',
  loadError: 'बिल लोड नहीं हुए। फिर से कोशिश करें।',
};

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: saved ?? (navigator.language.startsWith('hi') ? 'hi' : 'en'),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function toggleLanguage(): void {
  const next = i18n.language === 'hi' ? 'en' : 'hi';
  void i18n.changeLanguage(next);
  try {
    localStorage.setItem('lang', next);
  } catch {
    // storage unavailable (private mode) — language resets next visit
  }
}

export default i18n;
