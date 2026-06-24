import { useRef, useState, useCallback, useMemo, type RefObject } from 'react';
import IField, { CARD_TYPE, CVV_TYPE } from '@cardknox/react-ifields';

export interface CardForm {
  exp_month: string;
  exp_year: string;
  zip: string;
  is_default: boolean;
}

export const emptyCardForm: CardForm = {
  exp_month: '',
  exp_year: '',
  zip: '',
  is_default: false,
};

export interface CardSavePayload {
  card_sut: string;
  cvv_sut: string;
  exp_month: number;
  exp_year: number;
  zip?: string;
  is_default: boolean;
}

const EXPIRY_MONTHS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, '0'),
);

const EXPIRY_YEARS = (() => {
  const start = new Date().getFullYear();
  return Array.from({ length: 21 }, (_, i) => String(start + i));
})();

const SOLA_IFIELDS_KEY = import.meta.env.VITE_SOLA_IFIELDS_KEY || '';
const IFIELDS_ACCOUNT = {
  xKey: SOLA_IFIELDS_KEY,
  xSoftwareName: 'VoiceX',
  xSoftwareVersion: '1.0.0',
};

const IFRAME_WRAPPER_STYLE = {
  width: '100%',
  height: '32px',
  border: 'none',
  display: 'block',
};

const IFIELD_INPUT_STYLE: Record<string, string | Record<string, string>> = {
  border: 'none',
  outline: 'none',
  'border-radius': '0.25rem',
  'font-family':
    'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  'font-size': '14px',
  'line-height': '20px',
  padding: '6px 12px',
  width: '100%',
  'box-sizing': 'border-box',
  height: '32px',
  'background-color': 'transparent',
  color: '#111827',
  '::placeholder': {
    color: '#9ca3af',
    opacity: '1',
  },
  '::-webkit-input-placeholder': {
    color: '#9ca3af',
  },
  '::-moz-placeholder': {
    color: '#9ca3af',
    opacity: '1',
  },
};

const IFIELD_OPTIONS = {
  iFrameStyle: IFRAME_WRAPPER_STYLE,
  iFieldstyle: IFIELD_INPUT_STYLE,
};

const NATIVE_INPUT_CLASS =
  'mt-1 w-full rounded border border-gray-200 bg-white px-3 py-1.5 text-sm placeholder:text-gray-400';
const IFIELD_HOST_CLASS =
  'sola-ifield-host mt-1 min-w-0 rounded border border-gray-200 bg-white';

const MAX_CARD_DIGITS = 16;
const MAX_AMEX_DIGITS = 15;

interface IFieldHandle {
  getToken: () => void;
  clearIfield: () => void;
}

function maxCardDigits(issuer?: string): number {
  return issuer === 'amex' ? MAX_AMEX_DIGITS : MAX_CARD_DIGITS;
}

function cardNumberFieldError(
  data: { isEmpty: boolean; isValid: boolean; cardNumberLength: number; issuer?: string },
): string | null {
  const len = data.cardNumberLength ?? 0;
  if (len === 0) return null;

  const maxLen = maxCardDigits(data.issuer && data.issuer !== 'unknown' ? data.issuer : undefined);
  if (len > maxLen) {
    return `Card number cannot exceed ${maxLen} digits`;
  }
  if (!data.isValid && len >= 13) {
    return 'Please enter a valid card number';
  }
  if (!data.isValid) {
    return 'Please enter a valid card number';
  }
  return null;
}

function waitForIFieldToken(
  ref: RefObject<IFieldHandle | null>,
  onReady: (handlers: {
    resolve: (token: string) => void;
    reject: (err: Error) => void;
  }) => void,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Card tokenization timed out. Please try again.'));
    }, timeoutMs);

    onReady({
      resolve: (token) => {
        window.clearTimeout(timeout);
        resolve(token);
      },
      reject: (err) => {
        window.clearTimeout(timeout);
        reject(err);
      },
    });

    if (!ref.current) {
      window.clearTimeout(timeout);
      reject(new Error('Secure card field is not ready. Please wait and try again.'));
      return;
    }
    ref.current.getToken();
  });
}

export function CardFormFields({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  saveLabel = 'Save Card',
}: {
  form: CardForm;
  onChange: (f: CardForm) => void;
  onSave: (payload: CardSavePayload) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  saveLabel?: string;
}) {
  const cardRef = useRef<IFieldHandle | null>(null);
  const cvvRef = useRef<IFieldHandle | null>(null);
  const cardTokenWaiter = useRef<{
    resolve: (token: string) => void;
    reject: (err: Error) => void;
  } | null>(null);
  const cvvTokenWaiter = useRef<{
    resolve: (token: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const [cardValid, setCardValid] = useState(false);
  const [cvvValid, setCvvValid] = useState(false);
  const [cardFieldError, setCardFieldError] = useState<string | null>(null);
  const [cardIssuer, setCardIssuer] = useState<string | undefined>();
  const [ifieldError, setIfieldError] = useState<string | null>(null);
  const [tokenizing, setTokenizing] = useState(false);
  const [cardLoaded, setCardLoaded] = useState(false);
  const [cvvLoaded, setCvvLoaded] = useState(false);

  const onCardLoad = useCallback(() => setCardLoaded(true), []);
  const onCvvLoad = useCallback(() => setCvvLoaded(true), []);

  const cardFieldOptions = useMemo(
    () => ({
      ...IFIELD_OPTIONS,
      placeholder: '4242 4242 4242 4242',
      autoFormat: true,
      autoFormatSeparator: ' ',
    }),
    [],
  );

  const cvvFieldOptions = useMemo(
    () => ({
      ...IFIELD_OPTIONS,
      placeholder: '123',
    }),
    [],
  );

  const handleCardUpdate = useCallback(
    (data: {
      isEmpty: boolean;
      isValid: boolean;
      cardNumberLength: number;
      issuer?: string;
    }) => {
      const issuer =
        data.issuer && data.issuer !== 'unknown' ? data.issuer : undefined;
      const nextError = cardNumberFieldError({
        isEmpty: data.isEmpty,
        isValid: data.isValid,
        cardNumberLength: data.cardNumberLength,
        issuer,
      });

      setCardValid((prev) => (prev === data.isValid ? prev : data.isValid));
      setCardFieldError((prev) => (prev === nextError ? prev : nextError));
      if (issuer) {
        setCardIssuer((prev) => (prev === issuer ? prev : issuer));
      }
    },
    [],
  );

  const handleCvvUpdate = useCallback((data: { isValid: boolean }) => {
    setCvvValid((prev) => (prev === data.isValid ? prev : data.isValid));
  }, []);

  const onCardToken = useCallback((data: { xToken: string }) => {
    cardTokenWaiter.current?.resolve(data.xToken);
    cardTokenWaiter.current = null;
  }, []);

  const onCardError = useCallback((data: { errorMessage?: string }) => {
    const message = data.errorMessage || 'Card tokenization failed';
    setIfieldError(message);
    cardTokenWaiter.current?.reject(new Error(message));
    cardTokenWaiter.current = null;
  }, []);

  const onCvvToken = useCallback((data: { xToken: string }) => {
    cvvTokenWaiter.current?.resolve(data.xToken);
    cvvTokenWaiter.current = null;
  }, []);

  const onCvvError = useCallback((data: { errorMessage?: string }) => {
    const message = data.errorMessage || 'CVV tokenization failed';
    setIfieldError(message);
    cvvTokenWaiter.current?.reject(new Error(message));
    cvvTokenWaiter.current = null;
  }, []);

  const handleSaveClick = async () => {
    setIfieldError(null);

    if (!SOLA_IFIELDS_KEY) {
      alert('Sola iFields is not configured. Set VITE_SOLA_IFIELDS_KEY in the environment.');
      return;
    }

    if (!form.exp_month) {
      alert('Please select an expiration month');
      return;
    }
    const m = parseInt(form.exp_month, 10);
    if (!m || m < 1 || m > 12) {
      alert('Please select a valid expiration month');
      return;
    }
    if (!form.exp_year) {
      alert('Please select an expiration year');
      return;
    }
    const y = parseInt(form.exp_year, 10);
    if (!y || y < 2000) {
      alert('Please select a valid expiration year');
      return;
    }

    if (!cardValid || cardFieldError) {
      alert(cardFieldError || 'Please enter a valid card number');
      return;
    }
    if (!cvvValid) {
      alert('Please enter a valid CVV');
      return;
    }

    setTokenizing(true);
    try {
      const card_sut = await waitForIFieldToken(cardRef, (handlers) => {
        cardTokenWaiter.current = handlers;
      });

      const cvv_sut = await waitForIFieldToken(cvvRef, (handlers) => {
        cvvTokenWaiter.current = handlers;
      });

      await onSave({
        card_sut,
        cvv_sut,
        exp_month: m,
        exp_year: y,
        zip: form.zip || undefined,
        is_default: form.is_default,
      });
    } catch (err: any) {
      alert(err.message || 'Failed to tokenize card');
    } finally {
      setTokenizing(false);
    }
  };

  const busy = saving || tokenizing;

  if (!SOLA_IFIELDS_KEY) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Sola iFields is not configured.</p>
        <p className="text-xs">
          Set <code className="rounded bg-amber-100 px-1">VITE_SOLA_IFIELDS_KEY</code> and restart
          the admin dev server or redeploy.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-amber-400 px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
      <div>
        <label className="text-xs font-medium text-gray-600">Card Number *</label>
        <div className={`${IFIELD_HOST_CLASS}${cardFieldError ? ' border-red-400' : ''}`}>
          <IField
            ref={cardRef as any}
            type={CARD_TYPE}
            account={IFIELDS_ACCOUNT}
            options={cardFieldOptions}
            onLoad={onCardLoad}
            onToken={onCardToken}
            onError={onCardError}
            onUpdate={handleCardUpdate}
          />
        </div>
        {cardFieldError && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {cardFieldError}
          </p>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,1fr)] gap-2">
        <div className="min-w-0">
          <label className="text-xs font-medium text-gray-600">Exp Month *</label>
          <select
            value={form.exp_month}
            onChange={(e) => onChange({ ...form, exp_month: e.target.value })}
            className={NATIVE_INPUT_CLASS}
          >
            <option value="">MM</option>
            {EXPIRY_MONTHS.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs font-medium text-gray-600">Exp Year *</label>
          <select
            value={form.exp_year}
            onChange={(e) => onChange({ ...form, exp_year: e.target.value })}
            className={NATIVE_INPUT_CLASS}
          >
            <option value="">YYYY</option>
            {EXPIRY_YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs font-medium text-gray-600">CVV *</label>
          <div className={IFIELD_HOST_CLASS}>
            <IField
              ref={cvvRef as any}
              type={CVV_TYPE}
              account={IFIELDS_ACCOUNT}
              issuer={cardIssuer}
              options={cvvFieldOptions}
              onLoad={onCvvLoad}
              onToken={onCvvToken}
              onError={onCvvError}
              onUpdate={handleCvvUpdate}
            />
          </div>
        </div>
        <div className="min-w-0">
          <label className="text-xs font-medium text-gray-600">Billing ZIP</label>
          <input
            value={form.zip}
            onChange={(e) =>
              onChange({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 10) })
            }
            placeholder="12345"
            inputMode="numeric"
            className={NATIVE_INPUT_CLASS}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(e) => onChange({ ...form, is_default: e.target.checked })}
        />
        Default card
      </label>
      {ifieldError && (
        <p className="text-xs text-red-600" role="alert">
          {ifieldError}
        </p>
      )}
      <p className="text-xs text-gray-500">
        Card number and CVV are entered in secure Sola-hosted fields and tokenized before
        reaching our servers.
      </p>
      {(!cardLoaded || !cvvLoaded) && (
        <p className="text-xs text-amber-600" role="status">
          Loading secure card fields… If they stay blank, a browser extension (ad/privacy
          blocker) may be blocking <code>cdn.cardknox.com</code>. Disable it for this site or
          try an incognito window.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={busy || !cardValid || !cvvValid || !!cardFieldError}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Saving...' : saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
