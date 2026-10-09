import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { apiJson } from '../api';
import { useAuth } from '../auth/AuthContext';

const Login = () => {
  const { user, loading, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const googleBtnRef = useRef(null);
  const dest = location.state?.from?.pathname || '/';

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    apiJson('/api/auth/config').then(({ data }) => {
      setGoogleClientId(data.googleClientId || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleBtnRef.current) return;

    const renderButton = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          setBusy(true);
          setError('');
          try {
            await loginWithGoogle(response.credential);
            navigate(dest, { replace: true });
          } catch (err) {
            setError(err.message || 'Google login failed');
          } finally {
            setBusy(false);
          }
        }
      });
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 360,
        text: 'continue_with',
        shape: 'rectangular'
      });
    };

    if (window.google?.accounts?.id) {
      renderButton();
      return;
    }

    const existing = document.getElementById('google-gsi');
    if (existing) {
      existing.addEventListener('load', renderButton);
      return () => existing.removeEventListener('load', renderButton);
    }

    const script = document.createElement('script');
    script.id = 'google-gsi';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = renderButton;
    document.head.appendChild(script);
  }, [googleClientId, loginWithGoogle, dest, navigate]);

  if (!loading && user) {
    return <Navigate to={dest} replace />;
  }

  return (
    <div className="login-page">
      <div className="login-hero">
        <p className="login-kicker">Operations console</p>
        <h2>Send, track and control WhatsApp campaigns from one desk.</h2>
        <ul>
          <li>Email and Google sign-in</li>
          <li>Device sessions and live campaign logs</li>
          <li>Role-based access for your team</li>
        </ul>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <h3>Welcome back</h3>
          <p className="login-sub">Sign in with email or continue with Google.</p>
          {error && <div className="login-error">{error}</div>}
          <label className="field">
            <span>Email</span>
            <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@gmail.com" required />
          </label>
          <label className="field">
            <span>Password</span>
            <div className="password-wrap">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <button className="btn login-submit" type="submit" disabled={busy}>
            {busy ? 'Signing in...' : 'Enter workspace'}
          </button>
          {googleClientId ? (
            <>
              <div className="login-or">or continue with Google</div>
              <div ref={googleBtnRef} className="google-btn-slot" />
            </>
          ) : (
            <p className="login-note">Google login activates after GOOGLE_CLIENT_ID is set in backend/.env</p>
          )}
        </form>
      </div>
    </div>
  );
};

export default Login;
