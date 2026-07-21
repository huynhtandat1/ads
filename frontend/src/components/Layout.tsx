import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '../auth/AuthContext';
import { refreshOnNavigation } from '../data/store';

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();

  // Điều hướng nội bộ phải thấy dữ liệu mới ngay, không chờ nhịp polling 5 giây/F5.
  // Chờ mutation đang chạy để không lấy snapshot trước thời điểm thao tác lưu hoàn tất.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void refreshOnNavigation(() => active).catch((e) => {
      if (active && (e as Error)?.message !== 'unauthorized') console.warn('navigation sync failed', e);
    });
    return () => { active = false; };
  }, [location.pathname, user]);

  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
