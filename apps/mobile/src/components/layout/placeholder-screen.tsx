import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';

/** Sprint 0 placeholder body for screens whose real content arrives later. Strings arrive translated. */
export function PlaceholderScreen({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID: string;
}) {
  return (
    <Screen title={title} testID={testID} edges={['top']}>
      <Card variant="filled">
        <Text tone="muted">{body}</Text>
      </Card>
    </Screen>
  );
}
