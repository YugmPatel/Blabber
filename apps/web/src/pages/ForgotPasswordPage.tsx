import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '@/api/client';
import BlabberMark from '@/components/brand/BlabberMark';

const serifStyle: React.CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
const genericSuccessMessage =
  'If an account with that email exists, a password reset link has been sent.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = () => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }

    return true;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!validateEmail()) return;

    setIsLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSuccessMessage(genericSuccessMessage);
    } catch (err: any) {
      const message =
        err.response?.data?.message || 'We could not send a reset link right now. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-10">
      <section
        className="w-full max-w-[430px] rounded-[28px] bg-white px-8 py-10 shadow-[0_24px_80px_-20px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/5 sm:px-10"
        aria-labelledby="forgot-password-title"
      >
        <div className="mb-8 flex flex-col items-center gap-1">
          <div className="mb-1 flex items-center justify-center">
            <BlabberMark size={34} variant="lockup" mode="light" />
          </div>
          <h1
            id="forgot-password-title"
            className="mt-2 text-center text-[2rem] font-semibold leading-tight text-slate-900"
            style={serifStyle}
          >
            Reset your password
          </h1>
          <p className="mt-1 text-center text-[13.5px] leading-relaxed text-slate-500">
            Enter your email and we will send reset instructions if the account exists.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {error && (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </div>
          )}

          {successMessage && (
            <div
              className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800"
              role="status"
            >
              {successMessage}
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="block h-12 w-full rounded-[13px] border border-slate-200 bg-[#f5f6f8] px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
              placeholder="name@company.com"
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="h-12 w-full rounded-[13px] bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-7 text-center text-[13px] text-slate-500">
          Remember your password?{' '}
          <Link
            to="/login"
            className="font-semibold text-slate-900 transition hover:text-teal-700 focus:outline-none focus-visible:underline"
          >
            Back to sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
