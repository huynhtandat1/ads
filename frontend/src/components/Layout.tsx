import { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '../auth/AuthContext';
import { refreshOnNavigation } from '../data/store';
import { isUnauthorized } from '../api';

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Điều hướng nội bộ phải thấy dữ liệu mới ngay, không chờ nhịp polling định kỳ/F5.
  // Chờ mutation đang chạy để không lấy snapshot trước thời điểm thao tác lưu hoàn tất.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void refreshOnNavigation(() => active).catch((e) => {
      if (active && !isUnauthorized(e) && (e as Error)?.name !== 'AbortError') {
        console.warn('navigation sync failed', e);
      }
    });
    return () => { active = false; };
  }, [location.pathname, user]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileMenuOpen]);

  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onOpenMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 p-3 sm:p-4 lg:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
