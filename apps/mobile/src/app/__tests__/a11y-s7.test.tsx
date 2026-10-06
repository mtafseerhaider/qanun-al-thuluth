import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text as RNText } from 'react-native';

import { Button } from '@/components/ui/button';
import { ListScreen } from '@/components/ui/list-screen';
import { ErrorRetry, LoadingRow } from '@/components/ui/query-states';
import { fontScaleCap, MIN_BODY_FONT_SCALE, Text } from '@/components/ui/text';
import { SensoryCalmToggle } from '@/features/settings';
import { useAnnounceOnChange } from '@/hooks/use-announce';
import { useStackMotion } from '@/navigation/motion';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { renderWithProviders } from '@/test/render';
import { typeScale } from '@/theme/tokens';

/** Accessibility pass 2 (24 S7-04, 01 §9.3): props the screen readers and font scaling rely on. */
describe('a11y pass 2: primitives', () => {
  it('lets every text style under 18 pt reach 200 percent', () => {
    for (const script of ['latin', 'urdu'] as const) {
      for (const spec of Object.values(typeScale[script])) {
        const cap = fontScaleCap(spec);
        if (spec.size < 18) expect(cap).toBeGreaterThanOrEqual(MIN_BODY_FONT_SCALE);
        else expect(cap).toBe(spec.maxMultiplier);
      }
    }
  });

  it('passes the 200 percent cap to body text', async () => {
    await renderWithProviders(<Text testID="body">Water</Text>);
    expect(screen.getByTestId('body').props.maxFontSizeMultiplier).toBe(2);
  });

  it('marks Urdu UI text with the ur accessibility language', async () => {
    await renderWithProviders(<Text testID="ur-text">پانی</Text>, { locale: 'ur' });
    expect(screen.getByTestId('ur-text').props.accessibilityLanguage).toBe('ur');
  });

  it('does not mark English UI text with a language', async () => {
    await renderWithProviders(<Text testID="en-text">Water</Text>);
    expect(screen.getByTestId('en-text').props.accessibilityLanguage).toBeUndefined();
  });

  it('exposes disabled, busy and selected state on Button', async () => {
    await renderWithProviders(
      <>
        <Button label="Save" onPress={jest.fn()} loading testID="busy" />
        <Button label="Metric" onPress={jest.fn()} selected accessibilityRole="radio" />
      </>,
    );
    expect(screen.getByTestId('busy').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    expect(screen.getByRole('radio', { name: 'Metric' }).props.accessibilityState).toMatchObject({
      selected: true,
      checked: true,
    });
  });

  it('gives small buttons a hit slop that reaches 44 pt', async () => {
    await renderWithProviders(<Button label="Edit" size="sm" onPress={jest.fn()} testID="sm" />);
    // control-sm is 36 pt; 36 + 2 x 6 = 48 pt of touch area (WCAG 2.5.8, 01 §9.3).
    expect(screen.getByTestId('sm').props.hitSlop).toBe(6);
  });

  it('announces LoadingRow as one labelled, busy progress element', async () => {
    await renderWithProviders(<LoadingRow label="Loading…" testID="loading" />);
    const row = screen.getByTestId('loading');
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityRole).toBe('progressbar');
    expect(row.props.accessibilityLabel).toBe('Loading…');
    expect(row.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('pairs an announced alert with a retry button in ErrorRetry', async () => {
    const onRetry = jest.fn();
    await renderWithProviders(
      <ErrorRetry message="Something went wrong" retryLabel="Try again" onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ListScreen (virtualized list shell)', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));

  it('renders a header-role title, the header and only the visible rows', async () => {
    await renderWithProviders(
      <ListScreen
        title="Inbox"
        header={<RNText>Intro</RNText>}
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={(r) => <RNText testID={`row.${r.id}`}>{r.label}</RNText>}
        testID="list"
      />,
    );
    expect(screen.getByRole('header', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.getByTestId('row.r0')).toBeTruthy();
    // 100 rows, but FlashList mounts only the viewport plus its draw distance.
    expect(screen.queryByTestId('row.r99')).toBeNull();
  });

  it('shows the empty state when there are no rows', async () => {
    await renderWithProviders(
      <ListScreen
        data={[] as { id: string }[]}
        keyExtractor={(r) => r.id}
        renderItem={() => null}
        empty={<RNText>Nothing yet</RNText>}
      />,
    );
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });
});

describe('Sensory-calm toggle', () => {
  it('is a labelled switch that turns Sensory-calm mode on', async () => {
    usePreferencesStore.setState({ sensoryCalm: false });
    await renderWithProviders(<SensoryCalmToggle />);
    const toggle = screen.getByTestId('settings.sensory-calm');
    expect(toggle.props.accessibilityLabel).toBe('Sensory-calm mode');
    expect(toggle.props.accessibilityHint).toMatch(/no motion/);
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });
    expect(usePreferencesStore.getState().sensoryCalm).toBe(true);
  });
});

describe('announcements', () => {
  it('announces a status change but not the first value', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    function Probe({ phase }: { phase: string }) {
      useAnnounceOnChange(phase, `phase ${phase}`);
      return null;
    }
    const view = await renderWithProviders(<Probe phase="none" />);
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      view.rerender(<Probe phase="scheduled" />);
    });
    expect(spy).toHaveBeenCalledWith('phase scheduled');
    spy.mockRestore();
  });
});

describe('reduced motion', () => {
  it('crossfades stack transitions when Sensory-calm mode is on', async () => {
    let seen: unknown = null;
    function Probe() {
      seen = useStackMotion();
      return null;
    }
    usePreferencesStore.setState({ sensoryCalm: true });
    await act(async () => {
      await renderWithProviders(<Probe />);
    });
    expect(seen).toEqual({ animation: 'fade' });
    await act(async () => {
      usePreferencesStore.setState({ sensoryCalm: false });
    });
  });
});
