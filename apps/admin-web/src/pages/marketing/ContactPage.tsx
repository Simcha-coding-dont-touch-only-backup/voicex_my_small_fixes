import { useState, type ReactNode } from 'react';
import { Mail, MapPin, Phone, CheckCircle2, ChevronDown } from 'lucide-react';

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
  role: '',
  message: '',
};

const CONTACT_EMAIL = 'support@voicexservice.com';
const CONTACT_PHONE_DISPLAY = '929-579-1954';
const CONTACT_PHONE_TEL = 'tel:+19295791954';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function ContactPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: '' }));
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Name is required';
    if (!form.email.trim()) newErrors.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) newErrors.email = 'Please enter a valid email';
    if (!form.role.trim()) newErrors.role = 'Please choose how we should think of you';
    if (!form.message.trim()) newErrors.message = 'Message is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setStatus('submitting');
    setErrorMsg('');

    try {
      const resp = await fetch('/api/contact-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          source_path: window.location.pathname,
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong. Please try again or email us directly.');
      }

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
      <section className="bg-white pt-10 pb-24 sm:pt-12 lg:pt-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-3 lg:gap-16">
            <ContactInfo />
            <div className="lg:col-span-2">
              {status === 'success' ? (
                <SuccessCard
                  name={form.name}
                  onAnother={() => {
                    setForm(EMPTY);
                    setErrors({});
                    setStatus('idle');
                  }}
                />
              ) : (
                <form
                  onSubmit={onSubmit}
                  noValidate
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
                    <Field label="Full name" required error={errors.name}>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => update('name', e.target.value)}
                        className={getInputCls(!!errors.name)}
                        placeholder="Marvin Cooper"
                      />
                    </Field>
                    <Field label="Email" required error={errors.email}>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => update('email', e.target.value)}
                        className={getInputCls(!!errors.email)}
                        placeholder="marvin@company.com"
                      />
                    </Field>
                    <Field label="Company" error={errors.company}>
                      <input
                        type="text"
                        value={form.company}
                        onChange={(e) => update('company', e.target.value)}
                        className={getInputCls(!!errors.company)}
                        placeholder="Company, Inc."
                      />
                    </Field>
                    <Field
                      label="I'm a..."
                      required
                      error={errors.role}
                      errorId="contact-role-error"
                    >
                      <div className="relative">
                        <select
                          value={form.role}
                          onChange={(e) => update('role', e.target.value)}
                          aria-invalid={!!errors.role}
                          aria-describedby={errors.role ? 'contact-role-error' : undefined}
                          className={getSelectCls(!!errors.role)}
                        >
                          <option value="" disabled>
                            Select your role
                          </option>
                          <option value="merchant">Merchant or retailer</option>
                          <option value="investor">Investor</option>
                          <option value="partner">Partner / integrator</option>
                          <option value="press">Press</option>
                          <option value="other">Other</option>
                        </select>
                        <span
                          className={`pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg border-l ${
                            errors.role
                              ? 'border-rose-200 bg-rose-50/80 text-rose-600'
                              : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                          aria-hidden
                        >
                          <ChevronDown className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2} />
                        </span>
                      </div>
                    </Field>
                  </div>

                  <div className="mt-5">
                    <Field label="How can we help?" required error={errors.message}>
                      <textarea
                        rows={5}
                        value={form.message}
                        onChange={(e) => update('message', e.target.value)}
                        className={getInputCls(!!errors.message)}
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

const getInputCls = (hasError?: boolean) =>
  `block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 ${
    hasError
      ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-200'
      : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200'
  }`;

/** Native select: strip OS chrome, room for trailing chevron panel, hover/focus polish */
const getSelectCls = (hasError?: boolean) =>
  [
    'block w-full cursor-pointer rounded-lg border bg-white py-2.5 pl-3.5 pr-11 text-sm text-slate-900 shadow-sm transition-colors',
    'appearance-none [-webkit-appearance:none] [-moz-appearance:none]',
    'focus:outline-none focus:ring-2',
    hasError
      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
      : 'border-slate-300 hover:border-slate-400 focus:border-indigo-500 focus:ring-indigo-200',
    !hasError && 'hover:bg-slate-50/80',
  ]
    .filter(Boolean)
    .join(' ');

function Field({
  label,
  required,
  error,
  errorId,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  /** When set, error message span gets this id (e.g. for aria-describedby on inputs). */
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {error && (
        <span id={errorId} className="mt-1.5 block text-sm text-rose-500">
          {error}
        </span>
      )}
    </label>
  );
}

function PageHero() {
  return (
    <section className="relative overflow-hidden bg-white">
      {/* Full-width banner background using inline style to ensure Vite/Tailwind loads it */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-70"
        style={{ backgroundImage: "url('/assets/contact-hero-banner.jpg')" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 z-[1] bg-gradient-to-b from-white/40 via-white/70 to-white"
      />
      <div
        aria-hidden
        className="absolute -top-40 right-1/2 z-[2] h-[600px] w-[1200px] translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-200/20 via-violet-200/20 to-transparent blur-3xl"
      />

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-8">
        <h1 className="font-bold tracking-tight text-slate-900">
          <span className="block text-3xl font-bold uppercase tracking-wide text-indigo-600 sm:text-4xl">
            Contact
          </span>
          <span className="mt-4 block text-4xl sm:text-5xl">
            Let's talk.
          </span>
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
          value={CONTACT_PHONE_DISPLAY}
          href={CONTACT_PHONE_TEL}
        />
        <ContactRow
          icon={<MapPin size={18} />}
          label="Office"
          value={
            <>
              <span className="font-bold">VoiceX LLC</span> 194 Skillman St Apt 2R Brooklyn, NY 11205
            </>
          }
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
  value: ReactNode;
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
