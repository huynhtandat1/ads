import type { ComponentType, SVGProps } from 'react';
import {
  IconAdv, IconTraffic, IconImport, IconReport, IconBill, IconLog, IconSystem,
} from '../components/icons';

export interface MenuItem { id: string; path: string; }
export interface MenuGroup {
  id: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  children: MenuItem[];
}

export const MENU: MenuGroup[] = [
  { id: 'g1', icon: IconAdv, children: [
    { id: 'g1a', path: '/advertisers' },
    { id: 'g1b', path: '/ad-orders' },
    { id: 'g1c', path: '/ad-ids' },
  ] },
  { id: 'g2', icon: IconTraffic, children: [
    { id: 'g2a', path: '/media' },
    { id: 'g2b', path: '/media-orders' },
    { id: 'g2c', path: '/media-ids' },
  ] },
  { id: 'g3', icon: IconImport, children: [
    { id: 'g3a', path: '/import-ai' },
    { id: 'g3b', path: '/import-advertiser' },
    { id: 'g3c', path: '/import-media' },
    { id: 'g3d', path: '/import-yiyi' },
  ] },
  { id: 'g4', icon: IconReport, children: [
    { id: 'g4a', path: '/report-profit' },
    { id: 'g4b', path: '/report-order-profit' },
    { id: 'g4c', path: '/report-advertiser' },
    { id: 'g4d', path: '/report-media' },
    { id: 'g4e', path: '/report-yiyi' },
  ] },
  { id: 'g5', icon: IconBill, children: [
    { id: 'g5a', path: '/settle-advertiser' },
    { id: 'g5b', path: '/settle-media' },
  ] },
  { id: 'g6', icon: IconLog, children: [
    { id: 'g6', path: '/logs' },
  ] },
  { id: 'g7', icon: IconSystem, children: [
    { id: 'g7a', path: '/users' },
    { id: 'g7b', path: '/roles' },
    { id: 'g7c', path: '/data-isolation' },
  ] },
];

// Map screen id -> route (for breadcrumb / permission lookups)
export const SCREEN_PATH: Record<string, string> = Object.fromEntries(
  MENU.flatMap((g) => g.children.map((c) => [c.id, c.path])),
);
