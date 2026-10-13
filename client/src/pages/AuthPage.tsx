import { PASSWORD_RULES, USERNAME_RULES, passwordSchema, usernameSchema } from '@la-tour/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { errorMessage, t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';

/** Page de connexion ou d'inscription (pseudo + mot de passe uniquement). */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const login = useSession((s) => s.login);
  const register = useSession((s) => s.register);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isRegister = mode === 'register';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Mêmes règles que le serveur (schémas partagés), pour un message précis avant l'envoi.
    if (isRegister) {
      const problem = !usernameSchema.safeParse(username).success
        ? t('auth.register.usernameHelp')
        : !passwordSchema.safeParse(password).success
          ? t('auth.register.passwordHelp')
          : password !== confirm
            ? t('auth.register.mismatch')
            : null;
      if (problem) {
        setError(problem);
        return;
      }
    }
    setPending(true);
    setError(null);
    try {
      await (isRegister ? register : login)(username, password);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <main className="auth">
      <h1 className="logo">{t('app.title')}</h1>
      <form className="panel auth-form" onSubmit={submit}>
        <h2>{t(isRegister ? 'auth.register.title' : 'auth.login.title')}</h2>
        <label>
          {t('auth.username')}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={USERNAME_RULES.max}
            required
            autoFocus
          />
          {isRegister && <small>{t('auth.register.usernameHelp')}</small>}
        </label>
        <label>
          {t('auth.password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            maxLength={PASSWORD_RULES.max}
            required
          />
          {isRegister && <small>{t('auth.register.passwordHelp')}</small>}
        </label>
        {isRegister && (
          <>
            <label>
              {t('auth.passwordConfirm')}
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <p className="warning">{t('auth.register.noRecovery')}</p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={pending}>
          {t(isRegister ? 'auth.register.submit' : 'auth.login.submit')}
        </button>
        <Link to={isRegister ? '/connexion' : '/inscription'}>
          {t(isRegister ? 'auth.register.toLogin' : 'auth.login.toRegister')}
        </Link>
      </form>
    </main>
  );
}
