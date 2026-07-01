import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LangSwitch } from '../components/LangSwitch';

export function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState('admin');
  const [p, setP] = useState('admin');
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(false);
    const ok = await login(u, p);
    setLoading(false);
    if (ok) nav('/');
    else setErr(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-dark to-brand-dark2 p-4">
      <div className="absolute top-5 right-5"><LangSwitch dark /></div>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-6">
          <img src="/octopus.svg" alt="logo" className="w-16 h-16 mb-3" />
          <h1 className="text-2xl font-extrabold text-brand-dark">KrakenOcean</h1>
          <p className="text-sm text-gray-500 mt-1">{t('common.loginSub')}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('common.username')}</label>
            <input value={u} onChange={(e) => setU(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-300" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('common.password')}</label>
            <input type="password" value={p} onChange={(e) => setP(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-300" />
          </div>
          {err && <p className="text-sm text-rose-500">{t('common.loginError')}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 rounded-lg bg-cyan-500 text-white font-semibold hover:bg-cyan-600 transition-colors disabled:opacity-60">
            {loading ? '…' : t('common.login')}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-5 text-center">admin / admin &nbsp;·&nbsp; operator / 123456</p>
      </div>
    </div>
  );
}
