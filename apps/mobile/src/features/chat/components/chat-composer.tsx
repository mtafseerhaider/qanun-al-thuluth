import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

import { useVoiceInput } from '../hooks/use-voice-input';
import {
  formatClock,
  isRtlText,
  languageHint,
  mergeTranscript,
  VOICE_MAX_MS,
} from '../utils/voice-rules';

export const MAX_MESSAGE_CHARS = 4000;

/**
 * Composer (02 §7.7.2 region 5): multiline input (4,000 chars), camera (photo meal log) and mic
 * (voice), both premium; send becomes Stop while streaming. A voice transcript is placed into the
 * draft for review and editing; it is never sent automatically.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  premium,
  voiceEnabled,
  photoEnabled,
  householdId,
  locale,
  onPaywall,
  onPhoto,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: (inputMode: 'text' | 'voice') => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  premium: boolean;
  voiceEnabled: boolean;
  photoEnabled: boolean;
  householdId: string | null;
  locale: string;
  onPaywall: (trigger: 'voice' | 'photo', intent?: () => void) => void;
  onPhoto: () => void;
}) {
  const { t } = useTranslation(['chat', 'errors']);
  const colors = useThemeColors();
  const fromVoice = useRef(false);
  const voice = useVoiceInput({
    householdId,
    languageHint: languageHint(locale),
    onTranscript: (text) => {
      onChange(mergeTranscript(value, text));
      fromVoice.current = true;
    },
  });
  const recording = voice.state === 'recording';
  const transcribing = voice.state === 'transcribing';

  const mic = () => {
    if (!premium) {
      onPaywall('voice');
      return;
    }
    void voice.start();
  };

  return (
    <View className="gap-2 border-t border-line bg-surface px-4 py-3" testID="chat.composer">
      {recording ? (
        <View className="flex-row items-center justify-between gap-2" testID="chat.voice.recording">
          <Text accessibilityRole="text" testID="chat.voice.timer">
            {t('chat:voice.recording', {
              elapsed: formatClock(voice.elapsedMs),
              max: formatClock(VOICE_MAX_MS),
            })}
          </Text>
          <View className="flex-row gap-2">
            <Button
              label={t('chat:voice.cancel')}
              size="sm"
              variant="ghost"
              onPress={() => void voice.cancel()}
              testID="chat.voice.cancel"
            />
            <Button
              label={t('chat:voice.done')}
              size="sm"
              onPress={() => void voice.stop()}
              testID="chat.voice.stop"
            />
          </View>
        </View>
      ) : null}
      {transcribing ? (
        <Text variant="caption" tone="muted" testID="chat.voice.transcribing">
          {t('chat:voice.transcribing')}
        </Text>
      ) : null}
      {voice.state === 'denied' ? (
        <InlineMessage tone="warning" message={t('chat:voice.denied')} />
      ) : null}
      {voice.problem ? (
        <InlineMessage tone="info" message={t(`chat:voice.problem.${voice.problem}`)} />
      ) : null}
      {voice.state === 'error' ? (
        <InlineMessage tone="danger" message={t('chat:voice.failed')} testID="chat.voice.error" />
      ) : null}
      {fromVoice.current && value ? (
        <Text variant="caption" tone="muted" testID="chat.voice.review">
          {t('chat:voice.review')}
        </Text>
      ) : null}

      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.slice(0, MAX_MESSAGE_CHARS))}
        placeholder={t('chat:composer.placeholder')}
        placeholderTextColor={colors['ink-subtle']}
        multiline
        maxLength={MAX_MESSAGE_CHARS}
        editable={!disabled && !recording}
        accessibilityLabel={t('chat:composer.label')}
        className="max-h-40 min-h-control rounded-lg border border-line-strong bg-surface-raised px-3 py-2 font-ui text-body text-ink"
        style={{ writingDirection: isRtlText(value) ? 'rtl' : 'auto', textAlign: 'auto' }}
        testID="chat.composer.input"
      />
      <View className="flex-row items-center gap-2">
        {photoEnabled ? (
          <Button
            label={t('chat:composer.photo')}
            size="sm"
            variant="ghost"
            disabled={disabled || streaming || recording}
            onPress={() => (premium ? onPhoto() : onPaywall('photo', onPhoto))}
            testID="chat.composer.photo"
          />
        ) : null}
        {voiceEnabled ? (
          <Button
            label={t('chat:composer.voice')}
            size="sm"
            variant="ghost"
            disabled={disabled || streaming || recording || transcribing}
            onPress={mic}
            testID="chat.composer.voice"
          />
        ) : null}
        <View className="flex-1" />
        {streaming ? (
          <Button
            label={t('chat:composer.stop')}
            size="sm"
            variant="secondary"
            onPress={onStop}
            testID="chat.composer.stop"
          />
        ) : (
          <Button
            label={t('chat:composer.send')}
            size="sm"
            disabled={disabled || recording || transcribing || value.trim().length === 0}
            onPress={() => {
              const mode = fromVoice.current ? 'voice' : 'text';
              fromVoice.current = false;
              onSend(mode);
            }}
            testID="chat.composer.send"
          />
        )}
      </View>
    </View>
  );
}
