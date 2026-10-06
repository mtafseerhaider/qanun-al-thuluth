import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { Pressable, Text, View } from 'react-native';

import { i18n } from '@/lib/i18n/i18n';
import { reloadApp } from '@/lib/i18n/rtl';
import { captureException } from '@/lib/sentry/init';

/**
 * Root boundary (08 §9). The fallback is deliberately unthemed and uses only plain RN views, so it
 * still renders if the theme or navigation providers are what crashed.
 */
function RootFallback(_props: FallbackProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 16,
        backgroundColor: '#FBF8F2',
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 20, color: '#1D2521', textAlign: 'center' }}
      >
        {i18n.t('errors:generic.title')}
      </Text>
      <Text style={{ fontSize: 16, color: '#4A5650', textAlign: 'center' }}>
        {i18n.t('errors:generic.body')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void reloadApp()}
        style={{
          minHeight: 48,
          paddingHorizontal: 20,
          justifyContent: 'center',
          borderRadius: 12,
          backgroundColor: '#1F6F5C',
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16 }}>{i18n.t('common:restart')}</Text>
      </Pressable>
    </View>
  );
}

export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={RootFallback}
      onError={(error, info) =>
        captureException(error, {
          tags: { boundary: 'root', stack: String(info.componentStack ?? '').slice(0, 200) },
        })
      }
    >
      {children}
    </ErrorBoundary>
  );
}
