import { useMutation } from '@tanstack/react-query';

import { qk } from '@/lib/query/query-keys';

import { callAiSmoke } from '../api/ai-smoke-api';

export function useAiSmoke() {
  return useMutation({ mutationKey: qk.debug.aiSmoke(), mutationFn: callAiSmoke });
}
