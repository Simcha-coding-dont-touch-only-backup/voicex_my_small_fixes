import { useState } from 'react';
import { Mail, MapPin, Phone, CheckCircle2 } from 'lucide-react';

interface FormState {
  name: string;
  email: string;
  company: string;
  role: string;
  message: string;
}

const EMPTY: FormState = {
  name: '',
  email: '',
  company: '',
  role: 'merchant',
  message: '',
};

const CONTACT_EMAIL = 'hello@voicex.com';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function ContactPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');

    try {
      // Frontend-only: simulate submission, then mark success.
      // Wire this up to a real endpoint when the backend route is ready.
      await new Promise((resolve) => setTimeout(resolve, 600));
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again or email us directly.'
      );
    }
  };

  return (
    <>
      <PageHero />
      <section className="bg-white pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-3 lg:gap-16">
            <ContactInfo />
            <div className="lg:col-span-2">
              {status === 'success' ? (
                <SuccessCard
                  name={form.name}
                  onAnother={() => {
                    setForm(EMPTY);
                    setStatus('idle');
                  }}
                />
              ) : (
                <form
                  onSubmit={onSubmit}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
                >
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                    Send us a message
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Fill out the form and we'll get back to you within one
                    business day.
                  </p>

                  <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    <Field label="Full name" required>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => update('name', e.target.value)}
                        className={inputCls}
                        placeholder="Jane Cooper"
                      />
                    </Field>
                    <Field label="Email" required>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => update('email', e.target.value)}
                        className={inputCls}
                        placeholder="jane@company.com"
                      />
                    </Field>
                    <Field label="Company">
                      <input
                        type="text"
                        value={form.company}
                        onChange={(e) => update('company', e.target.value)}
                        className={inputCls}
                        placeholder="Company, Inc."
                      />
                    </Field>
                    <Field label="I'm a..." required>
                      <select
                        required
                        value={form.role}
                        onChange={(e) => update('role', e.target.value)}
                        className={inputCls}
                      >
                        <option value="merchant">Merchant or retailer</option>
                        <option value="investor">Investor</option>
                        <option value="partner">Partner / integrator</option>
                        <option value="press">Press</option>
                        <option value="other">Other</option>
                      </select>
                    </Field>
                  </div>

                  <div className="mt-5">
                    <Field label="How can we help?" required>
                      <textarea
                        required
                        rows={5}
                        value={form.message}
                        onChange={(e) => update('message', e.target.value)}
                        className={inputCls}
                        placeholder="Tell us a bit about what you're looking for…"
                      />
                    </Field>
                  </div>

                  {status === 'error' && (
                    <div className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100">
                      {errorMsg ||
                        'Something went wrong. Please try again or email us directly.'}
                    </div>
                  )}

                  <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-slate-500">
                      Prefer email?{' '}
                      <a
                        href={`mailto:${CONTACT_EMAIL}`}
                        className="font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {CONTACT_EMAIL}
                      </a>
                    </p>
                    <button
                      type="submit"
                      disabled={status === 'submitting'}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    >
                      {status === 'submitting' ? 'Sending…' : 'Send message'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

const inputCls =
  'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function PageHero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50/70 to-white"
      />
      <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
          Contact
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Let's talk.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          Demos, partnerships, investment, press — drop us a note and we'll
          respond within one business day.
        </p>
      </div>
    </section>
  );
}

function ContactInfo() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Get in touch</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          We'd love to hear about your project, your retail catalog, or how
          you're thinking about voice-first commerce.
        </p>
      </div>

      <ul className="space-y-5">
        <ContactRow
          icon={<Mail size={18} />}
          label="Email"
          value={CONTACT_EMAIL}
          href={`mailto:${CONTACT_EMAIL}`}
        />
        <ContactRow
          icon={<Phone size={18} />}
          label="Phone"
          value="845-422-4025"
          href="tel:+18454224025"
        />
        <ContactRow
          icon={<MapPin size={18} />}
          label="Office"
          value="Remote-first · United States"
        />
      </ul>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-sm font-semibold text-slate-900">For investors</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          We're happy to share a deck, walk through metrics, and arrange a live
          call with the product. Mention "Investor" in your message and we'll
          fast-track a follow-up.
        </p>
      </div>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const Inner = (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-slate-900">{value}</p>
      </div>
    </div>
  );
  return (
    <li>
      {href ? (
        <a href={href} className="block hover:opacity-80 transition-opacity">
          {Inner}
        </a>
      ) : (
        Inner
      )}
    </li>
  );
}

function SuccessCard({
  name,
  onAnother,
}: {
  name: string;
  onAnother: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-8 sm:p-10">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 size={24} />
      </div>
      <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
        Thanks{name ? `, ${name.split(' ')[0]}` : ''} — your message is in.
      </h2>
      <p className="mt-3 text-base leading-relaxed text-slate-700">
        We've received your note and will reach out within one business day. In
        the meantime, feel free to explore our{' '}
        <a
          href="/features"
          className="font-medium text-indigo-700 underline-offset-2 hover:underline"
        >
          features
        </a>{' '}
        or read more{' '}
        <a
          href="/about"
          className="font-medium text-indigo-700 underline-offset-2 hover:underline"
        >
          about us
        </a>
        .
      </p>
      <button
        type="button"
        onClick={onAnother}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        Send another message
      </button>
    </div>
  );
}
