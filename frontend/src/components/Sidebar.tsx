import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MENU } from '../config/menu';
import { useAuth } from '../auth/AuthContext';
import { IconChevron, IconClose, IconDash } from './icons';

interface Props {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: Props) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const loc = useLocation();

  // Filter to groups the user can see at least one child of
  const groups = MENU.map((g) => ({
    ...g,
    children: g.children.filter((c) => can(c.id, 'view')),
  })).filter((g) => g.children.length > 0);

  const activeGroup = MENU.find((g) => g.children.some((c) => c.path === loc.pathname))?.id;
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => (activeGroup ? { [activeGroup]: true } : {}),
  );

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label={t('common.close', { defaultValue: 'Close menu' })}
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
        />
      )}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shrink-0 bg-gradient-to-b from-brand-dark to-brand-dark2 text-white flex flex-col h-dvh shadow-2xl transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/10">
        <img src="/octopus.svg" alt="logo" className="w-8 h-8" />
        <span className="flex-1 text-lg font-extrabold tracking-tight">KrakenOcean</span>
        <button
          type="button"
          aria-label={t('common.close', { defaultValue: 'Close menu' })}
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <IconClose width={20} height={20} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto thin-scroll py-3 px-3 space-y-1">
        <NavLink to="/" end onClick={onClose} className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            isActive ? 'bg-white/10 text-cyan-300' : 'text-white/75 hover:bg-white/5 hover:text-white'}`}>
          <IconDash width={18} height={18} /> {t('common.dashboard')}
        </NavLink>

        {groups.map((g) => {
          const isOpen = open[g.id];
          const Icon = g.icon;
          return (
            <div key={g.id}>
              <button onClick={() => toggle(g.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/85 hover:bg-white/5 transition-colors">
                <Icon width={18} height={18} />
                <span className="flex-1 text-left font-medium">{t(`menu.${g.id}`)}</span>
                <IconChevron width={16} height={16}
                  className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-0.5">
                  {g.children.map((c) => (
                    <NavLink key={c.path} to={c.path} onClick={onClose} className={({ isActive }) =>
                      `relative flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-white/10 text-cyan-300 font-medium before:absolute before:-left-3 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-4 before:rounded-full before:bg-cyan-400'
                          : 'text-white/65 hover:bg-white/5 hover:text-white'}`}>
                      {t(`menu.${c.id}`)}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 px-5 py-4 border-t border-white/10">
        <div className="w-9 h-9 rounded-full bg-cyan-500 flex items-center justify-center font-bold uppercase">
          {user?.username?.[0] || 'A'}
        </div>
        <div className="leading-tight">
          <div className="text-sm font-medium">{user?.username}</div>
          <div className="text-xs text-cyan-300">{user?.role}</div>
        </div>
      </div>
      </aside>
    </>
  );
}
