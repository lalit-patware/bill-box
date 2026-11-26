import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { brand } from '../../config/brand';

const UPDATED = '26 November 2026';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8 leading-relaxed text-slate-800">
      <Link to="/" className="text-sm text-brand underline">
        ← {brand.name}
      </Link>
      <h1 className="mt-4 mb-1 text-2xl font-semibold">{title}</h1>
      <p className="mb-6 text-sm text-slate-500">Last updated: {UPDATED}</p>
      <div className="space-y-4 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p>
        {brand.name} helps you keep your bills. This page explains what we collect, why, who processes it, and the
        choices you have. It applies to the {brand.name} app and website.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Account:</b> your email address, and your name and profile picture if you sign in with Google.
        </li>
        <li>
          <b>Bills you add:</b> photos and PDFs of bills, details read from them (shop name, date, amounts, items, bill
          number, warranty or exchange dates, notes) and any changes you make.
        </li>
        <li>
          <b>Codes on bills:</b> data from QR codes and barcodes that your phone reads, such as GST invoice details or a
          shop&apos;s UPI ID.
        </li>
        <li>
          <b>Technical data:</b> basic logs needed to run and secure the service (time, request type, errors). We do
          not log the contents of your bills.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To store your bills and show them back to you, search them, and remind you about deadlines.</li>
        <li>To read bill details automatically. Bill images are sent to an AI model only for this purpose.</li>
        <li>To keep the service working and secure.</li>
      </ul>
      <p>We do not sell your data and we do not use it for advertising.</p>

      <h2>Who processes your data</h2>
      <ul>
        <li>
          <b>Supabase</b>: database, sign-in and private file storage, hosted in Mumbai, India.
        </li>
        <li>
          <b>Vercel</b>: hosts the app; our server functions run in Mumbai, India.
        </li>
        <li>
          <b>Anthropic (Claude API)</b>: reads bill images to extract details, under its commercial API terms.
        </li>
        <li>
          <b>Google</b>: only if you choose &quot;Continue with Google&quot; to sign in.
        </li>
      </ul>

      <h2>Medical bills</h2>
      <p>
        Doctor, pharmacy and hospital bills can contain health information. We store them privately like any other
        bill. We do not read or interpret prescriptions, medicines or doses, and we never give medical advice.
      </p>

      <h2>Security</h2>
      <p>
        Bill files are kept in private storage and shown through short-lived links. Each household can only access its
        own data. Data is encrypted in transit.
      </p>

      <h2>Keeping and deleting data</h2>
      <p>
        We keep your bills until you delete them. Deleting a bill removes its photos and details. To delete your whole
        account and all its data, email us at the address below; we will do it within 30 days.
      </p>

      <h2>Your rights</h2>
      <p>
        Under India&apos;s Digital Personal Data Protection Act, 2023, you can ask to access, correct or erase your
        personal data, withdraw consent, and raise a grievance. Contact us and we will respond promptly.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a className="text-brand underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
      </p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of Use">
      <p>By using {brand.name} you agree to these terms.</p>

      <h2>The service</h2>
      <p>
        {brand.name} stores photos and PDFs of your bills and reads details from them automatically. Reading is done by
        software and AI and <b>can be wrong</b>. Please check important details (amounts, dates, warranty periods)
        against the original bill before relying on them.
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of the bills you add. You give us permission to store and process them only to provide the
        service to you. Only add bills you are entitled to keep.
      </p>

      <h2>Not advice</h2>
      <p>
        {brand.name} does not give legal, tax, financial or medical advice. Reminders are a convenience; you remain
        responsible for deadlines such as exchange windows and warranty claims.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&apos;t misuse the service, try to access other people&apos;s data, or upload unlawful content.</p>

      <h2>Plans and changes</h2>
      <p>
        Some features may be paid. We will show prices before you buy. We may change these terms or the service and
        will post updates on this page.
      </p>

      <h2>Liability</h2>
      <p>
        The service is provided &quot;as is&quot;. To the extent the law allows, we are not liable for losses caused by
        incorrect readings or missed reminders.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of India.</p>

      <h2>Contact</h2>
      <p>
        <a className="text-brand underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
      </p>
    </Page>
  );
}
