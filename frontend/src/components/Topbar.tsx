import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MENU } from '../config/menu';
import { useAuth } from '../auth/AuthContext';
import { LangSwitch } from './LangSwitch';
import { IconLogout } from './icons';

export function Topbar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const nav = useNavigate();
  const { logout } = useAuth();

  let crumbs: string[] = [t('common.dashboard')];
  for (const g of MENU) {
    const child = g.children.find((c) => c.path === loc.pathname);
    if (child) { crumbs = [t(`menu.${g.id}`), t(`menu.${child.id}`)]; break; }
  }

  const onLogout = () => { logout(); nav('/login'); };

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 sticky top-0 z-20">
      <nav className="flex items-center gap-2 text-sm">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-gray-300">/</span>}
            <span className={i === crumbs.length - 1 ? 'font-semibold text-gray-800' : 'text-gray-400'}>{c}</span>
          </span>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-4">
        <LangSwitch />
        <button onClick={onLogout}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:text-rose-500 hover:border-rose-200">
          <IconLogout width={16} height={16} /> {t('common.logout')}
        </button>
      </div>
    </header>
  );
}
