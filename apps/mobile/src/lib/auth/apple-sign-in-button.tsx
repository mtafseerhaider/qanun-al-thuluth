import * as AppleAuthentication from 'expo-apple-authentication';

/**
 * Apple's own button (Human Interface Guidelines), wrapped here because SDK imports are allowed only
 * in lib/ and app/ (07 §8.2 rule 4). The label is localised by iOS.
 */
export function AppleSignInButton({
  onPress,
  dark,
  testID,
}: {
  onPress: () => void;
  dark: boolean;
  testID?: string;
}) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={
        dark
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={12}
      style={{ height: 52, alignSelf: 'stretch' }}
      onPress={onPress}
      {...(testID ? { testID } : {})}
    />
  );
}
