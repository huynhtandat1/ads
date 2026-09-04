import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MENU } from '../config/menu';
import { useAuth } from '../auth/AuthContext';
import { LangSwitch } from './LangSwitch';
import { IconLogout, IconMenu } from './icons';

export function Topbar({ onOpenMenu }: { onOpenMenu?: () => void }) {
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
    <header className="h-14 sm:h-16 bg-white border-b border-gray-200 flex items-center gap-2 px-3 sm:px-4 lg:px-6 sticky top-0 z-20">
      <button
        type="button"
        aria-label={t('common.menu', { defaultValue: 'Menu' })}
        onClick={onOpenMenu}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 lg:hidden"
      >
        <IconMenu width={21} height={21} />
      </button>
      <nav className="min-w-0 flex items-center gap-2 text-sm overflow-hidden">
        {crumbs.map((c, i) => (
          <span key={i} className={`min-w-0 items-center gap-2 ${i === crumbs.length - 1 ? 'flex' : 'hidden sm:flex'}`}>
            {i > 0 && <span className="text-gray-300">/</span>}
            <span className={`${i === crumbs.length - 1 ? 'font-semibold text-gray-800' : 'text-gray-400'} truncate`}>{c}</span>
          </span>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <LangSwitch />
        <button onClick={onLogout}
          title={t('common.logout')}
          aria-label={t('common.logout')}
          className="h-9 w-9 sm:w-auto sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:text-rose-500 hover:border-rose-200">
          <IconLogout width={16} height={16} /> <span className="hidden sm:inline">{t('common.logout')}</span>
        </button>
      </div>
    </header>
  );
}
