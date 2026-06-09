import React, { useState } from "react";
import { insforge } from "../services/insforge";

interface AuthProps {
  onSuccess: (user: any) => void;
}

export default function Auth({ onSuccess }: AuthProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await insforge.auth.signUp({
          email,
          password,
          name: name || undefined,
        });

        if (signUpError) {
          setError(signUpError.message || "Failed to sign up. Please try again.");
          // If user already exists but isn't verified, let's offer to verify
          if (signUpError.message.toLowerCase().includes("exist") || signUpError.message.toLowerCase().includes("registered")) {
            setError(signUpError.message + " If you need to verify your email, please use the link at the bottom.");
          }
        } else if (data?.requireEmailVerification) {
          setShowVerify(true);
        } else if (data?.user) {
          onSuccess(data.user);
        }
      } else {
        const { data, error: signInError } = await insforge.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          // If sign in fails because the email is not verified, redirect to verification view
          if (
            signInError.error === "EMAIL_NOT_VERIFIED" || 
            signInError.message.toLowerCase().includes("verification") ||
            signInError.message.toLowerCase().includes("verify") ||
            signInError.message.toLowerCase().includes("confirmed")
          ) {
            setShowVerify(true);
          } else {
            setError(signInError.message || "Invalid email or password.");
          }
        } else if (data?.user) {
          onSuccess(data.user);
        }
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const { data, error: verifyError } = await insforge.auth.verifyEmail({
        email,
        otp,
      });

      if (verifyError) {
        setError(verifyError.message || "Invalid verification code.");
      } else if (data?.user) {
        onSuccess(data.user);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during verification.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!email) {
      setError("Please enter your email address to resend the code.");
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const { data, error: resendError } = await insforge.auth.resendVerificationEmail({
        email,
      });

      if (resendError) {
        setError(resendError.message || "Failed to resend verification email.");
      } else {
        setSuccessMessage("A new verification code has been sent to your email.");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (showVerify) {
    return (
      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-3 tracking-wider uppercase">
            Verify Your Email
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-indigo-300">
            Confirm Verification Code
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Enter your email and the 6-digit confirmation code.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-100 text-sm placeholder-slate-600 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              6-Digit Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-100 text-center text-lg tracking-widest placeholder-slate-700 transition-colors font-mono"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-medium">
              {successMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3.5 bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-bold rounded-xl tracking-wide transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Verifying...</span>
              </>
            ) : (
              <span>Verify Code</span>
            )}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            onClick={() => {
              setShowVerify(false);
              setError(null);
              setSuccessMessage(null);
              setOtp("");
            }}
            className="font-semibold text-slate-500 hover:text-slate-300 transition-colors cursor-pointer text-xs"
          >
            Back to login
          </button>

          <button
            onClick={handleResendCode}
            disabled={loading}
            className="font-semibold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer text-xs disabled:opacity-50"
          >
            Resend Code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-3 tracking-wider uppercase">
          AI Kubernetes Troubleshooting Agent
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-indigo-300">
          {isSignUp ? "Create Account" : "Welcome Back"}
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          {isSignUp ? "Sign up to start troubleshooting your clusters" : "Sign in to access your Kubernetes agent"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {isSignUp && (
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-100 text-sm placeholder-slate-600 transition-colors"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-100 text-sm placeholder-slate-600 transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl focus:border-indigo-500 focus:outline-none text-slate-100 text-sm placeholder-slate-600 transition-colors"
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-3.5 bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-bold rounded-xl tracking-wide transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-2 cursor-pointer"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>{isSignUp ? "Registering..." : "Signing in..."}</span>
            </>
          ) : (
            <span>{isSignUp ? "Sign Up" : "Sign In"}</span>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-slate-500">
          {isSignUp ? "Already have an account?" : "New to the platform?"}{" "}
        </span>
        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError(null);
            setSuccessMessage(null);
          }}
          className="font-semibold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
        >
          {isSignUp ? "Sign In" : "Create Account"}
        </button>
      </div>

      <div className="mt-4 text-center text-xs border-t border-slate-800/60 pt-4">
        <button
          onClick={() => {
            setShowVerify(true);
            setError(null);
            setSuccessMessage(null);
          }}
          className="font-medium text-slate-500 hover:text-slate-400 transition-colors cursor-pointer"
        >
          Have a verification code? Verify email here
        </button>
      </div>
    </div>
  );
}
