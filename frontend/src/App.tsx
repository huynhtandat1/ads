import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CrudPage } from './pages/CrudPage';
import { AdvDataEntryPage } from './pages/AdvDataEntryPage';
import { MediaDataEntryPage } from './pages/MediaDataEntryPage';
import { AdvReportPage } from './pages/AdvReportPage';
import { MediaReportPage } from './pages/MediaReportPage';
import { AggregateReportPage, type AggregateSpec } from './pages/AggregateReportPage';
import { TotalProfitPage } from './pages/TotalProfitPage';
import { SettlementPage } from './pages/SettlementPage';
import { LogsPage } from './pages/LogsPage';
import { RolesPage } from './pages/RolesPage';
import { DataIsolationPage } from './pages/DataIsolationPage';
import { getAll, type Row } from './data/store';

// 业务 = tên đơn quảng cáo (360 / sm / Qianwen...): gộp chung các 广告主 có cùng đơn,
// không tách "advertiser / order" như trước (spec #9: 查询按业务分类).
// Nghiệp vụ bám theo đơn QC của ID QUẢNG CÁO (khóa chung nối thu NQC ↔ chi media),
// KHÔNG dùng r.adOrderId của dòng media vì hồ sơ Media ID có thể ghi lệch đơn QC so
// với adId → khiến chi phí media rơi sang nghiệp vụ khác với doanh thu ("chi phí ảo").
const adOrderName = (r: Row) => {
  const adId = r.adIdId != null ? getAll('adIds').find((a) => a.id === r.adIdId) : undefined;
  const orderId = adId?.adOrderId ?? r.adOrderId;
  if (orderId == null) return '';
  const order = getAll('adOrders').find((o) => o.id === orderId);
  return order ? String(order.name) : '';
};

const REPORTS: Record<string, AggregateSpec> = {
  g4b: {
    screen: 'g4b', titleKey: 'menu.g4b', collections: ['importAI', 'importAdv', 'importMedia'],
    dim: adOrderName,
    dimLabelKey: 'col.adOrder',
    withTax: true,
  },
};

/** Renders the right page only if the user has view permission for that screen. */
function Guard({ screen, children }: { screen: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(screen, 'view')) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />

              <Route path="advertisers" element={<Guard screen="g1a"><CrudPage screen="g1a" /></Guard>} />
              <Route path="ad-orders" element={<Guard screen="g1b"><CrudPage screen="g1b" /></Guard>} />
              <Route path="ad-ids" element={<Guard screen="g1c"><CrudPage screen="g1c" /></Guard>} />

              <Route path="media" element={<Guard screen="g2a"><CrudPage screen="g2a" /></Guard>} />
              <Route path="media-orders" element={<Guard screen="g2b"><CrudPage screen="g2b" /></Guard>} />
              <Route path="media-ids" element={<Guard screen="g2c"><CrudPage screen="g2c" /></Guard>} />

              <Route path="import-ai" element={<Guard screen="g3a"><AdvDataEntryPage screen="g3a" collection="importAI" source="AI" titleKey="menu.g3a" ai /></Guard>} />
              <Route path="import-advertiser" element={<Guard screen="g3b"><AdvDataEntryPage /></Guard>} />
              <Route path="import-media" element={<Guard screen="g3c"><MediaDataEntryPage /></Guard>} />

              <Route path="report-profit" element={<Guard screen="g4a"><TotalProfitPage /></Guard>} />
              <Route path="report-order-profit" element={<Guard screen="g4b"><AggregateReportPage key="g4b" spec={REPORTS.g4b} /></Guard>} />
              <Route path="report-advertiser" element={<Guard screen="g4c"><AdvReportPage /></Guard>} />
              <Route path="report-media" element={<Guard screen="g4d"><MediaReportPage /></Guard>} />

              <Route path="settle-advertiser" element={<Guard screen="g5a"><SettlementPage screen="g5a" collection="settleAdv" titleKey="menu.g5a" targetFrom="advertisers" previewType="adv" /></Guard>} />
              <Route path="settle-media" element={<Guard screen="g5b"><SettlementPage screen="g5b" collection="settleMedia" titleKey="menu.g5b" targetFrom="media" previewType="media" /></Guard>} />

              <Route path="logs" element={<Guard screen="g6"><LogsPage /></Guard>} />

              <Route path="users" element={<Guard screen="g7a"><CrudPage screen="g7a" /></Guard>} />
              <Route path="roles" element={<Guard screen="g7b"><RolesPage /></Guard>} />
              <Route path="data-isolation" element={<Guard screen="g7c"><DataIsolationPage /></Guard>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
