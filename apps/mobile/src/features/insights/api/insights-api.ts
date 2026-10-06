import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import { parseInsights, type WeeklyInsight } from '../utils/insights-rules';

export async function fetchFamilyInsights(
  householdId: string,
  weeks: number,
): Promise<WeeklyInsight[]> {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  const { data, error } = await supabase.rpc('get_family_insights', {
    p_household: householdId,
    p_weeks: weeks,
  });
  if (error) throw toDbAppError(error);
  return parseInsights(data);
}
