import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getAll,
  setActor,
  clearDB,
  refreshFromServer,
  refreshOnNavigation,
  useCollection,
} from '../data/store';
import { api, authState, setToken, clearToken, hasToken, isUnauthorized } from '../api';

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
      const session = authState();
      setActor(user.username);
      void refreshFromServer(() => (
        active
        && authState().generation === session.generation
        && authState().token === session.token
      ))
        .catch((e) => {
          if (!active) return;
          // Mạng/5xx không làm mất phiên. 401 hợp lệ thường đã được listener bên
          // dưới xử lý đồng bộ; kiểm tra token để tránh logout hai lần.
          if (isUnauthorized(e)) {
            if (authState().generation === session.generation) doLogout(session.generation);
          } else if ((e as Error)?.name !== 'AbortError') {
            console.warn('initial sync failed', e);
          }
        })
        .finally(() => { if (active) setBooting(false); });
    } else {
      if (user) doLogout();
      setBooting(false);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự đăng xuất khi API trả 401 (token hết hiệu lực).
  useEffect(() => {
    const onUnauth = (event: Event) => {
      const generation = (event as CustomEvent<{ generation?: number }>).detail?.generation;
      if (generation !== undefined && authState().generation === generation) doLogout(generation);
    };
    window.addEventListener('ko-unauthorized', onUnauth);
    return () => window.removeEventListener('ko-unauthorized', onUnauth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự nhận dữ liệu mới mà không cần F5: đồng bộ định kỳ khi tab đang hiển thị,
  // đồng thời đồng bộ ngay khi người dùng quay lại cửa sổ/tab.
  useEffect(() => {
    if (!user || booting || !hasToken()) return;
    const session = authState();
    let disposed = false;
    let running = false;
    const sync = async () => {
      if (
        disposed
        || running
        || document.visibilityState === 'hidden'
        || authState().generation !== session.generation
      ) return;
      running = true;
      try {
        await refreshFromServer(() => (
          !disposed
          && authState().generation === session.generation
          && authState().token === session.token
        ));
      }
      catch (e) {
        // Mất mạng tạm thời không phá cache hiện tại; 401 đã có listener tự đăng xuất.
        if (!isUnauthorized(e) && (e as Error)?.name !== 'AbortError') console.warn('background sync failed', e);
      } finally {
        running = false;
      }
    };
    const onFocus = () => { void sync(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void sync(); };
    // Rải nhịp 45–75 giây để nhiều tab mở cùng lúc không đồng loạt đánh thức
    // backend; mỗi request không đổi chỉ nhận response revision rất nhỏ.
    let timer: number | undefined;
    const schedule = () => {
      const delay = 45_000 + Math.floor(Math.random() * 30_001);
      timer = window.setTimeout(async () => {
        await sync();
        if (!disposed) schedule();
      }, delay);
    };
    schedule();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, booting]);

  // Subscribe roles collection để khi admin sửa quyền của role user đang dùng, hook
  // re-render và perms được resolve lại ngay (không cần logout/login).
  const roles = useCollection('roles');
  const perms = useMemo(() => (user ? resolvePerms(user.role) : {}), [user, booting, roles]);

  const login = async (username: string, password: string) => {
    let sessionGeneration: number | null = null;
    try {
      const { token, user: u } = await api.login(username, password);
      sessionGeneration = setToken(token);
      // Dataset không còn nằm trong response login. Reset revision của phiên cũ,
      // rồi tải đúng một full snapshot trước khi mở giao diện được bảo vệ.
      clearDB();
      await refreshOnNavigation(() => (
        sessionGeneration !== null
        && authState().generation === sessionGeneration
      ));
      if (authState().generation !== sessionGeneration || !hasToken()) return false;
      const usr: User = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, scope: u.scope };
      setActor(usr.username);
      localStorage.setItem('ko_user', JSON.stringify(usr));
      setUser(usr);
      return true;
    } catch {
      // Chỉ dọn phiên do chính lần login này tạo; không đụng một phiên mới hơn.
      if (sessionGeneration !== null && authState().generation === sessionGeneration) {
        clearToken();
        clearDB();
      }
      return false;
    }
  };

  const doLogout = (expectedGeneration?: number) => {
    if (expectedGeneration !== undefined && authState().generation !== expectedGeneration) return;
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
