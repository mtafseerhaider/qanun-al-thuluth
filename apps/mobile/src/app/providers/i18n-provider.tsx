import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n } from '@/lib/i18n/i18n';

/** i18next is initialised synchronously in bootstrap(); direction changes reload the app (lib/i18n/rtl.ts). */
export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
