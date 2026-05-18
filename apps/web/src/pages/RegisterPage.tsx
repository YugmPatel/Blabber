import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Eye, EyeOff, Check } from 'lucide-react';
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

      {/* SVG wave layers */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ width: '100%', height: '100%' }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          d="M -2 56 C 15 44, 38 46, 52 49 C 66 52, 84 43, 103 38 L 103 103 L -2 103 Z"
          fill="rgba(20,184,166,0.80)"
        />
        <path
          d="M -2 65 C 20 55, 46 57, 60 60 C 76 63, 90 56, 103 50 L 103 103 L -2 103 Z"
          fill="rgba(88,28,135,0.88)"
        />
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

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, isAuthenticated } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/chats', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const validateForm = (): boolean => {
    if (!name.trim()) {
      setError('Full name is required');
      return false;
    }
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!username.trim()) {
      setError('Username is required');
      return false;
    }
    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores');
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
    if (!agreeToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue');
      return;
    }
    setIsLoading(true);
    try {
      await register(username, email, password, name);
      navigate('/chats', { replace: true });
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Registration failed. Please try again.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const passwordChecks = [
    { label: 'At least 8 characters', valid: password.length >= 8 },
    { label: 'Contains a number or symbol', valid: /[\d\W]/.test(password) },
    { label: 'Contains uppercase letter', valid: /[A-Z]/.test(password) },
  ];
  const strengthScore = passwordChecks.filter((c) => c.valid).length;

  const inputClass =
    'block h-12 w-full rounded-[13px] border border-slate-200 bg-[#f5f6f8] px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 disabled:opacity-50';

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
        <section className="flex items-center justify-center px-8 py-10 sm:px-12 md:px-14">
          <div className="w-full max-w-[380px]">
            {/* Logo */}
            <div className="mb-7 flex flex-col items-center gap-1">
              <div className="mb-1 flex items-center gap-2.5">
                <BlabberLogo size={30} />
                <span className="text-[17px] font-semibold tracking-tight text-slate-900">Blabber</span>
              </div>
              <h2
                className="mt-2 text-center text-[2.2rem] font-semibold leading-tight text-slate-900"
                style={serifStyle}
              >
                Create Account
              </h2>
              <p className="mt-1 text-center text-[13.5px] text-slate-500">
                Join Blabber to start organizing your conversations
              </p>
            </div>

            <form className="space-y-3.5" onSubmit={handleSubmit} noValidate>
              {error && (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {/* Full Name */}
              <div>
                <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-slate-700">
                  Full Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="Jane Doe"
                  disabled={isLoading}
                />
              </div>

              {/* Work Email */}
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-slate-700">
                  Work Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="name@company.com"
                  disabled={isLoading}
                />
              </div>

              {/* Username */}
              <div>
                <label htmlFor="username" className="mb-1.5 block text-[13px] font-medium text-slate-700">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputClass}
                  placeholder="janedoe"
                  disabled={isLoading}
                />
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-11`}
                    placeholder="Create a strong password"
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
                {/* Strength indicator */}
                {password.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    <div className="grid grid-cols-3 gap-1.5">
                      {[1, 2, 3].map((bar) => (
                        <div
                          key={bar}
                          className={`h-1.5 rounded-full transition-colors ${
                            strengthScore >= bar ? 'bg-teal-500' : 'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="space-y-0.5">
                      {passwordChecks.map((check) => (
                        <p
                          key={check.label}
                          className={`flex items-center gap-1.5 text-xs transition-colors ${
                            check.valid ? 'text-teal-600' : 'text-slate-400'
                          }`}
                        >
                          <Check size={11} strokeWidth={2.5} />
                          {check.label}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Workspace Name (optional, visual-only — not sent to backend) */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="workspaceName" className="block text-[13px] font-medium text-slate-700">
                    Workspace Name
                  </label>
                  <span className="text-[11px] text-slate-400">Optional</span>
                </div>
                <input
                  id="workspaceName"
                  name="workspaceName"
                  type="text"
                  autoComplete="organization"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. Acme Corp"
                  disabled={isLoading}
                />
              </div>

              {/* Terms */}
              <label className="flex cursor-pointer items-start gap-2.5 pt-0.5 text-[13px] text-slate-500">
                <input
                  type="checkbox"
                  checked={agreeToTerms}
                  onChange={(e) => setAgreeToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
                />
                <span>
                  I agree to Blabber&apos;s{' '}
                  <button type="button" className="font-semibold text-teal-700 hover:underline focus:outline-none">
                    Terms of Service
                  </button>{' '}
                  and{' '}
                  <button type="button" className="font-semibold text-teal-700 hover:underline focus:outline-none">
                    Privacy Policy
                  </button>
                  .
                </span>
              </label>

              <button
                type="submit"
                disabled={isLoading}
                className="mt-1 h-12 w-full rounded-[13px] bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Creating Account…' : 'Create Account'}
              </button>
            </form>

            <p className="mt-6 text-center text-[13px] text-slate-500">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-semibold text-slate-900 transition hover:text-teal-700 focus:outline-none focus-visible:underline"
              >
                Sign In
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
