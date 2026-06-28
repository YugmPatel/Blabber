import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { API_URL } from '@/api/client';
import { Eye, EyeOff } from 'lucide-react';
import BlabberLogo from '@/components/BlabberLogo';

const serifStyle: React.CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };

function BrandPanel() {
  return (
    <aside
      className="relative hidden overflow-hidden md:flex md:flex-col md:justify-between"
      style={{
        padding: '48px',
        background: 'linear-gradient(170deg, #c084fc 0%, #9333ea 18%, #7c3aed 36%, #5b21b6 56%, #1e1b4b 78%, #0d1f2d 100%)',
      }}
    >
      {/* Warm peach/cream light — upper center */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 72% 48% at 42% 24%, rgba(255,210,160,0.58) 0%, rgba(240,130,170,0.22) 52%, transparent 76%)',
        }}
      />

      {/* SVG wave layers — clean defined edges matching the reference */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ width: '100%', height: '100%' }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* Teal wave — sweeps from lower-left to upper-right */}
        <path
          d="M -2 56 C 15 44, 38 46, 52 49 C 66 52, 84 43, 103 38 L 103 103 L -2 103 Z"
          fill="rgba(20,184,166,0.80)"
        />
        {/* Deep purple wave — behind teal, slightly lower */}
        <path
          d="M -2 65 C 20 55, 46 57, 60 60 C 76 63, 90 56, 103 50 L 103 103 L -2 103 Z"
          fill="rgba(88,28,135,0.88)"
        />
        {/* Dark navy base wave at the very bottom */}
        <path
          d="M -2 78 C 25 71, 52 73, 67 75 C 82 77, 94 72, 103 68 L 103 103 L -2 103 Z"
          fill="rgba(10,16,46,0.94)"
        />
      </svg>

      {/* Top label */}
      <div
        className="relative flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.28em] text-white/65"
        style={{ zIndex: 1 }}
      >
        <span>Blabber Vision</span>
        <span className="h-px w-8 bg-white/35" />
      </div>

      {/* Bottom text block */}
      <div className="relative space-y-4" style={{ zIndex: 1 }}>
        <h1
          className="text-[3.4rem] font-semibold leading-[1.06] text-white"
          style={serifStyle}
        >
          Talk.
          <br />
          Decide.
          <br />
          Do.
        </h1>
        <p className="max-w-[22ch] text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.78)' }}>
          Turn conversations into summaries, tasks, decisions, and shared memory seamlessly.
        </p>
      </div>
    </aside>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated } = useAuth();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/chats';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(safeReturnTo, { replace: true });
    }
  }, [isAuthenticated, navigate, safeReturnTo]);

  useEffect(() => {
    const oauthError = searchParams.get('oauth');
    if (!oauthError) return;

    const messages: Record<string, string> = {
      google_config_missing: 'Google sign-in is not configured for this environment yet.',
      google_cancelled: 'Google sign-in was cancelled.',
      google_invalid_state: 'Google sign-in could not be verified. Please try again.',
      google_unverified_email: 'Google did not provide a verified email address.',
      google_failed: 'Google sign-in failed. Please try again.',
    };

    setError(messages[oauthError] || 'Google sign-in failed. Please try again.');
  }, [searchParams]);

  const validateForm = (): boolean => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!password) {
      setError('Password is required');
      return false;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      await login(email, password);
      navigate(safeReturnTo, { replace: true });
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Invalid email or password';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    setError('');
    setIsGoogleLoading(true);
    window.location.href = `${API_URL}/api/auth/google/start`;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-10">
      <div
        className="grid w-full overflow-hidden rounded-[28px] bg-white md:grid-cols-2"
        style={{
          maxWidth: '1160px',
          boxShadow: '0 24px 80px -20px rgba(15,23,42,0.22), 0 0 0 1px rgba(15,23,42,0.06)',
        }}
      >
        <BrandPanel />

        {/* Right form panel */}
        <section className="flex items-center justify-center px-8 py-12 sm:px-12 md:px-14">
          <div className="w-full max-w-[380px]">
            {/* Logo */}
            <div className="mb-8 flex flex-col items-center gap-1">
              <div className="mb-1 flex items-center gap-2.5">
                <BlabberLogo size={30} />
                <span className="text-[17px] font-semibold tracking-tight text-slate-900">Blabber</span>
              </div>
              <h2
                className="mt-2 text-center text-[2.2rem] font-semibold leading-tight text-slate-900"
                style={serifStyle}
              >
                Welcome Back
              </h2>
              <p className="mt-1 text-center text-[13.5px] text-slate-500">
                Enter your email and password to access your workspace
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
                  onChange={(e) => setEmail(e.target.value)}
                  className="block h-12 w-full rounded-[13px] border border-slate-200 bg-[#f5f6f8] px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
                  placeholder="name@company.com"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block h-12 w-full rounded-[13px] border border-slate-200 bg-[#f5f6f8] px-3.5 pr-11 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
                  />
                  Remember me
                </label>
                <Link
                  to="/forgot-password"
                  className="text-[13px] font-semibold text-slate-700 transition hover:text-slate-900 focus:outline-none focus-visible:underline"
                >
                  Forgot Password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="mt-1 h-12 w-full rounded-[13px] bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Signing In…' : 'Sign In'}
              </button>

              {/* Divider */}
              <div className="relative flex items-center gap-3 py-0.5">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
                  Or continue with
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Social buttons */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading || isGoogleLoading}
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[13px] border border-slate-200 bg-white text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                  <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                </svg>
                {isGoogleLoading ? 'Redirecting to Google…' : 'Sign in with Google'}
              </button>
            </form>

            <p className="mt-7 text-center text-[13px] text-slate-500">
              Don&apos;t have an account?{' '}
              <Link
                to="/register"
                className="font-semibold text-slate-900 transition hover:text-teal-700 focus:outline-none focus-visible:underline"
              >
                Sign Up
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
