import { useEffect, useState } from 'react';

export type AssistantTheme = 'light' | 'dark' | 'system';

export function useResolvedTheme(theme: AssistantTheme): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(media.matches);
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme]);
  return theme === 'system' ? systemDark ? 'dark' : 'light' : theme;
}