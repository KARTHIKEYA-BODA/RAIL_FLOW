import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'hi' | 'te';
export type OperatorRole = 'controller' | 'supervisor' | 'viewer';
type Preferences = { theme: 'day' | 'night'; language: Language; guided: boolean; audio: boolean; role: OperatorRole; operator: string };
const defaults: Preferences = { theme: 'night', language: 'en', guided: false, audio: true, role: 'controller', operator: 'Duty Controller' };
const Context = createContext({ ...defaults, setPreference: <K extends keyof Preferences>(_key: K, _value: Preferences[K]) => {} });

export function WorkspacePreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const v2 = localStorage.getItem('trainvision-preferences-v2');
      if (v2) return { ...defaults, ...JSON.parse(v2) };
      const legacy = localStorage.getItem('trainvision-preferences');
      if (legacy) {
        const parsed = JSON.parse(legacy);
        // Default to night for OCC control room standard unless user manually set v2
        return { ...defaults, ...parsed, theme: 'night' };
      }
      return defaults;
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    localStorage.setItem('trainvision-preferences-v2', JSON.stringify(preferences));
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.lang = preferences.language;
  }, [preferences]);
  function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences(prev => ({ ...prev, [key]: value }));
  }
  return <Context.Provider value={{ ...preferences, setPreference }}>{children}</Context.Provider>;
}

export const usePreferences = () => useContext(Context);

const words = {
  en: { now: 'Now', platforms: 'Platforms', timeline: 'Timeline', alerts: 'Alerts', history: 'History', tools: 'Tools', review: 'Review', guided: 'Guided mode', complete: 'Done. No open conflicts.', other: 'Show other options', move: 'Review this move', read: 'Read aloud', clear: 'All reported conflicts are clear.', controller: 'The controller makes the final decision.', search: 'Find a train or open a page' },
  hi: { now: 'अभी', platforms: 'प्लेटफ़ॉर्म', timeline: 'समयरेखा', alerts: 'अलर्ट', history: 'इतिहास', tools: 'उपकरण', review: 'समीक्षा करें', guided: 'सरल मोड', complete: 'हो गया। कोई खुला टकराव नहीं है।', other: 'अन्य विकल्प देखें', move: 'इस बदलाव की समीक्षा करें', read: 'सुनें', clear: 'सभी दर्ज टकराव दूर हो गए हैं।', controller: 'अंतिम निर्णय नियंत्रक लेता है।', search: 'ट्रेन खोजें या पृष्ठ खोलें' },
  te: { now: 'ఇప్పుడు', platforms: 'ప్లాట్‌ఫారమ్‌లు', timeline: 'కాలక్రమం', alerts: 'హెచ్చరికలు', history: 'చరిత్ర', tools: 'సాధనాలు', review: 'సమీక్షించండి', guided: 'సులభ మోడ్', complete: 'పూర్తయింది. పరిష్కరించని సమస్యలు లేవు.', other: 'ఇతర ఎంపికలు చూడండి', move: 'ఈ మార్పును సమీక్షించండి', read: 'వినండి', clear: 'నమోదైన సమస్యలన్నీ పరిష్కరించబడ్డాయి.', controller: 'తుది నిర్ణయం కంట్రోలర్ తీసుకుంటారు.', search: 'రైలు వెతకండి లేదా పేజీ తెరవండి' },
};
export function useWords() { return words[usePreferences().language] ?? words.en; }
export function guidedAlert(language: Language, trains: string[], platform: number | undefined, station: string, target?: number) {
  const names = trains.join(' / ');
  if (language === 'hi') return names + ' के बीच ' + station + ' के प्लेटफ़ॉर्म ' + platform + ' पर पर्याप्त समय का अंतर नहीं है।' + (target ? ' ट्रेन को प्लेटफ़ॉर्म ' + target + ' पर भेजने की समीक्षा करें।' : '');
  if (language === 'te') return names + ' రైళ్ల మధ్య ' + station + ' ప్లాట్‌ఫారమ్ ' + platform + ' వద్ద తగిన సమయ అంతరం లేదు.' + (target ? ' రైలును ప్లాట్‌ఫారమ్ ' + target + ' కు మార్చే ఎంపికను సమీక్షించండి.' : '');
  return 'These trains will use platform ' + platform + ' at ' + station + ' too close together. ' + names + '.' + (target ? ' Review moving the train to platform ' + target + '.' : '');
}
export function speak(text: string, language: Language) {
  if (!('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = { en:'en-IN', hi:'hi-IN', te:'te-IN' }[language];
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
  return true;
}

