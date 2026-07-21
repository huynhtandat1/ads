import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAll, setActor, hydrate, clearDB, refreshFromServer } from '../data/store';
import { api, setToken, clearToken, hasToken } from '../api';

export type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'export';

interface User { id: number; username: string; fullName: string; role: string; scope?: string }

interface AuthCtx {
  user: User | null;
  booting: boolean;
  login: (u: string, p: string) => Promise<boolean>;
  logout: () => void;
  can: (screen: string, action: PermAction) => boolean;
}

const Ctx = createContext<AuthCtx>(null!);

function resolvePerms(role: string): '*' | Record<string, Record<string, boolean>> {
  const r = getAll('roles').find((x) => x.name === role);
  if (!r) return {};
  if (r.permissions === '*') return '*';
  try { return JSON.parse(r.permissions); } catch { return {}; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('ko_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [booting, setBooting] = useState(true);

  // On reload: re-hydrate dataset from backend using the stored token.
  useEffect(() => {
    let active = true;
    if (user && hasToken()) {
      setActor(user.username);
      api.fetchDB()
        .then((res) => { if (active) { hydrate(res.db); setBooting(false); } })
        .catch(() => { if (active) { doLogout(); setBooting(false); } });
    } else {
      setBooting(false);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự đăng xuất khi API trả 401 (token hết hiệu lực).
  useEffect(() => {
    const onUnauth = () => doLogout();
    window.addEventListener('ko-unauthorized', onUnauth);
    return () => window.removeEventListener('ko-unauthorized', onUnauth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự nhận dữ liệu mới mà không cần F5: đồng bộ định kỳ khi tab đang hiển thị,
  // đồng thời đồng bộ ngay khi người dùng quay lại cửa sổ/tab.
  useEffect(() => {
    if (!user || booting || !hasToken()) return;
    let disposed = false;
    let running = false;
    const sync = async () => {
      if (disposed || running || document.visibilityState === 'hidden') return;
      running = true;
      try { await refreshFromServer(); }
      catch (e) {
        // Mất mạng tạm thời không phá cache hiện tại; 401 đã có listener tự đăng xuất.
        if ((e as Error)?.message !== 'unauthorized') console.warn('background sync failed', e);
      } finally {
        running = false;
      }
    };
    const onFocus = () => { void sync(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void sync(); };
    const timer = window.setInterval(() => { void sync(); }, 5_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, booting]);

  const perms = useMemo(() => (user ? resolvePerms(user.role) : {}), [user, booting]);

  const login = async (username: string, password: string) => {
    try {
      const { token, user: u, db } = await api.login(username, password);
      setToken(token);
      hydrate(db);
      const usr: User = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, scope: u.scope };
      setUser(usr);
      setActor(usr.username);
      localStorage.setItem('ko_user', JSON.stringify(usr));
      return true;
    } catch {
      return false;
    }
  };

  const doLogout = () => {
    setUser(null);
    clearToken();
    clearDB();
    localStorage.removeItem('ko_user');
  };

  const can = (screen: string, action: PermAction) => {
    if (!user) return false;
    if (perms === '*') return true;
    return Boolean(perms[screen]?.[action]);
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-gray-400">
        <div className="animate-pulse text-sm">KrakenOcean…</div>
      </div>
    );
  }

  return <Ctx.Provider value={{ user, booting, login, logout: doLogout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
