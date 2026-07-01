import { useTranslation } from 'react-i18next';
import { setLang } from '../i18n';

const LANGS = [
  { code: 'zh', label: '中' },
  { code: 'vi', label: 'VI' },
  { code: 'en', label: 'EN' },
];

export function LangSwitch({ dark }: { dark?: boolean }) {
  const { i18n } = useTranslation();
  const cur = i18n.language;
  return (
    <div className={`inline-flex items-center gap-1 rounded-full p-1 ${dark ? 'bg-white/10' : 'bg-gray-100'}`}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
            cur === l.code
              ? 'bg-cyan-500 text-white'
              : dark ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
