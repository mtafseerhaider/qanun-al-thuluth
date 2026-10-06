import { fireEvent, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { Button } from '../button';
import { Card } from '../card';
import { Input } from '../input';
import { Screen } from '../screen';
import { Text } from '../text';

describe('UI primitives', () => {
  it('renders Text as a header when asked', async () => {
    await renderWithProviders(
      <Text variant="title" accessibilityRole="header">
        Today
      </Text>,
    );
    expect(screen.getByRole('header', { name: 'Today' })).toBeTruthy();
  });

  it('marks Arabic scripture with the ar accessibility language', async () => {
    await renderWithProviders(
      <Text script="arabic" testID="ayah">
        بِسْمِ اللَّهِ
      </Text>,
    );
    expect(screen.getByTestId('ayah').props.accessibilityLanguage).toBe('ar');
  });

  it('gives Button a button role, its label and calls onPress', async () => {
    const onPress = jest.fn();
    await renderWithProviders(
      <Button label="Generate plan" onPress={onPress} testID="plan.generate-button" />,
    );
    const button = screen.getByRole('button', { name: 'Generate plan' });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('plan.generate-button')).toBeTruthy();
  });

  it('marks a loading Button busy and blocks presses', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Save" onPress={onPress} loading testID="save" />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('save.spinner')).toBeTruthy();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('makes a pressable Card a single labelled button', async () => {
    const onPress = jest.fn();
    await renderWithProviders(
      <Card onPress={onPress} accessibilityLabel="Breakfast, 3 members">
        <View />
      </Card>,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Breakfast, 3 members' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('labels Input and announces its error', async () => {
    await renderWithProviders(
      <Input
        label="Email"
        value=""
        onChangeText={() => undefined}
        errorText="Enter a valid email"
        testID="field.email"
      />,
    );
    const input = screen.getByLabelText('Email');
    expect(input.props.accessibilityHint).toBe('Enter a valid email');
    expect(input.props['aria-invalid']).toBe(true);
    expect(screen.getByTestId('field.email.error')).toBeTruthy();
  });

  it('renders Screen with a header-role title and testID', async () => {
    await renderWithProviders(
      <Screen title="More" testID="settings-more-home.screen">
        <View />
      </Screen>,
    );
    expect(screen.getByTestId('settings-more-home.screen')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'More' })).toBeTruthy();
  });

  it('switches Text to the Nastaliq font set in Urdu', async () => {
    await renderWithProviders(<Text testID="t">سلام</Text>, { locale: 'ur' });
    // includeFontPadding stays on for Nastaliq (03 §5.3 rule 3).
    expect(screen.getByTestId('t').props.style).toEqual(
      expect.objectContaining({ includeFontPadding: true }),
    );
  });
});
