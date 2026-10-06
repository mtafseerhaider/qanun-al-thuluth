import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { cn } from '@/theme/cn';

import { useEdgePadding } from './screen';
import { Text } from './text';
import type { BaseProps } from './types';

export interface ListScreenProps<T> extends BaseProps {
  /** Rows to virtualize. Everything else on the screen goes in `header` and `footer`. */
  data: readonly T[];
  renderItem: (item: T, index: number) => ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  title?: string;
  /** Content above the rows (intro, filters, messages). Laid out like Screen's body. */
  header?: ReactNode;
  /** Shown instead of rows when `data` is empty. */
  empty?: ReactNode;
  footer?: ReactNode;
  edges?: readonly Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  /** State the rows read besides `data` (an open editor, a pending confirm); rows re-render on change. */
  extraData?: unknown;
}

const CONTENT_PADDING = { paddingHorizontal: 16, paddingVertical: 24 } as const;

function Separator() {
  return <View className="h-3" />;
}

/**
 * Screen shell for long lists (24 S7-01, 01 §9.1 "60 fps on lists of 100 items (FlashList)"): the
 * same safe area, keyboard avoidance, padding and header-role title as `Screen`, with rows
 * virtualized by FlashList so only what is on screen is mounted. Rows are 12 pt apart (gap-3) and
 * the header and footer keep Screen's 24 pt rhythm.
 */
export function ListScreen<T>({
  data,
  renderItem,
  keyExtractor,
  title,
  header,
  empty,
  footer,
  edges = ['bottom'],
  refreshing = false,
  onRefresh,
  onEndReached,
  extraData,
  className,
  testID,
}: ListScreenProps<T>) {
  const padding = useEdgePadding(edges);
  const render = useCallback(
    ({ item, index }: ListRenderItemInfo<T>) => renderItem(item, index),
    [renderItem],
  );
  const hasHeader = Boolean(title) || Boolean(header);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className={cn('flex-1 bg-surface', className)}
      style={padding}
      {...(testID ? { testID } : {})}
    >
      <FlashList
        data={data}
        renderItem={render}
        keyExtractor={keyExtractor}
        extraData={extraData}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={CONTENT_PADDING}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          hasHeader ? (
            <View className="gap-6 pb-6">
              {title ? (
                <Text variant="title" accessibilityRole="header">
                  {title}
                </Text>
              ) : null}
              {header}
            </View>
          ) : null
        }
        ListEmptyComponent={empty ? <View>{empty}</View> : null}
        ListFooterComponent={footer ? <View className="gap-6 pt-6">{footer}</View> : null}
        {...(onEndReached ? { onEndReached, onEndReachedThreshold: 0.5 } : {})}
        {...(onRefresh
          ? { refreshControl: <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> }
          : {})}
        {...(testID ? { testID: `${testID}.list` } : {})}
      />
    </KeyboardAvoidingView>
  );
}
