import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword } from '@/api/client';
import BlabberLogo from '@/components/BlabberLogo';

const serifStyle: React.CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validateForm = () => {
    if (!token) {
      setError('This reset link is missing a valid token.');
      return false;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }

    if (password.length > 100) {
      setError('Password must be 100 characters or fewer');
      return false;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    return true;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const response = await resetPassword(token, password);
      setSuccessMessage(response.message || 'Password has been reset successfully.');
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const message =
        err.response?.data?.message || 'This reset link is invalid or expired. Please request a new one.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-10">
      <section
        className="w-full max-w-[430px] rounded-[28px] bg-white px-8 py-10 shadow-[0_24px_80px_-20px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/5 sm:px-10"
        aria-labelledby="reset-password-title"
      >
        <div className="mb-8 flex flex-col items-center gap-1">
          <div className="mb-1 flex items-center gap-2.5">
            <BlabberLogo size={30} />
            <span className="text-[17px] font-semibold tracking-tight text-slate-900">Blabber</span>
          </div>
          <h1
            id="reset-password-title"
            className="mt-2 text-center text-[2rem] font-semibold leading-tight text-slate-900"
            style={serifStyle}
          >
            Choose a new password
          </h1>
          <p className="mt-1 text-center text-[13.5px] leading-relaxed text-slate-500">
            Set a new password for your account.
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

          {!token && (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              role="status"
            >
              This reset link is missing a token. Request a new password reset link to continue.
            </div>
          )}

          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-[13px] font-medium text-slate-700">
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="block h-12 w-full rounded-[13px] border border-slate-200 bg-[#f5f6f8] px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
              placeholder="At least 8 characters"
              disabled={isLoading || !token || !!successMessage}
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1.5 block text-[13px] font-medium text-slate-700"
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="block h-12 w-full rounded-[13px] border border-slate-200 bg-[#f5f6f8] px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
              placeholder="Repeat your password"
              disabled={isLoading || !token || !!successMessage}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !token || !!successMessage}
            className="h-12 w-full rounded-[13px] bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>

        <p className="mt-7 text-center text-[13px] text-slate-500">
          Need another link?{' '}
          <Link
            to="/forgot-password"
            className="font-semibold text-slate-900 transition hover:text-teal-700 focus:outline-none focus-visible:underline"
          >
            Request reset
          </Link>
        </p>
      </section>
    </div>
  );
}
