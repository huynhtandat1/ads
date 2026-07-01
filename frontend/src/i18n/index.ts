import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import vi from './vi';
import zh from './zh';
import en from './en';

const saved = localStorage.getItem('ko_lang') || 'vi';

i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi },
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: saved,
  fallbackLng: 'vi',
  interpolation: { escapeValue: false },
});

export function setLang(lng: string) {
  i18n.changeLanguage(lng);
  localStorage.setItem('ko_lang', lng);
}

export default i18n;
