import type { SupabaseClient } from '@supabase/supabase-js';

import { countPdfPages } from '../export-pdf/renderer.ts';
import type { PdfRenderer } from '../export-pdf/renderer.ts';
import { supabaseExportStore } from '../export-pdf/store.ts';
import { growthReportHtml, mealPlanHtml } from '../export-pdf/templates.ts';
import { check } from '../_shared/platform.ts';
import type { PdfAttachment } from './handler.ts';

/**
 * PDFs for the account bundle (06 §4.12 `include_pdfs`): the household's current meal plan (first
 * week) and a growth report per child with measurements, rendered with the export-pdf templates.
 */
export function accountPdfs(admin: SupabaseClient, renderer: PdfRenderer) {
  const store = supabaseExportStore(admin);
  return async (householdId: string, locale: 'en' | 'ur'): Promise<PdfAttachment[]> => {
    const out: PdfAttachment[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const name = (await store.householdName(householdId)) ?? '';
    const plan = check(
      await admin
        .from('meal_plans')
        .select('id')
        .eq('household_id', householdId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as { id: string } | null;
    if (plan) {
      const data = await store.mealPlan(householdId, plan.id, 0, locale);
      if (data) {
        const html = mealPlanHtml(
          { ...data, householdName: name, includeRecipes: false, includeSources: true },
          locale,
          'A4',
          today,
        );
        const bytes = await renderer.render(html, {
          paper: 'A4',
          marginMm: 14,
          title: 'Meal plan',
          lang: locale,
        });
        if (countPdfPages(bytes) > 0) out.push({ name: `meal-plan-${plan.id}.pdf`, bytes });
      }
    }
    const members = check(
      await admin
        .from('growth_tracking')
        .select('family_member_id')
        .eq('household_id', householdId)
        .limit(1000),
    ) as Array<{ family_member_id: string }>;
    for (const memberId of new Set(members.map((m) => m.family_member_id))) {
      const data = await store.growth(householdId, memberId);
      if (!data?.rows.length) continue;
      const html = growthReportHtml(
        { ...data, householdName: name, includeNotesForClinician: false },
        locale,
        'A4',
        today,
      );
      const bytes = await renderer.render(html, {
        paper: 'A4',
        marginMm: 14,
        title: 'Growth report',
        lang: locale,
      });
      out.push({ name: `growth-report-${memberId}.pdf`, bytes });
    }
    return out;
  };
}
