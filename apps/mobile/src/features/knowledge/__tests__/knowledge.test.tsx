import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { KnowledgeEmptyState, SourceCard } from '../components/knowledge-parts';
import { RecommendationCard } from '../components/recommendation-card';
import {
  evidenceForDisplay,
  gradeDots,
  isDisplayable,
  pickLocale,
  sourcesForDisplay,
  visibleTraditions,
  type EvidenceView,
  type RecommendationView,
  type SourceView,
} from '../utils/knowledge-rules';

const source = (patch: Partial<SourceView>): SourceView => ({
  id: 's',
  kind: 'hadith',
  tradition: 'shared',
  citationText: 'Tirmidhi 2380',
  relationship: 'supports',
  grade: 'sahih',
  gradedBy: 'al-Albani',
  arabicText: null,
  translation: 'The son of Adam fills no vessel worse than his stomach.',
  translator: null,
  verifiedBy: { name: 'Mufti A', on: '2026-09-01' },
  ...patch,
});

const study = (patch: Partial<EvidenceView>): EvidenceView => ({
  id: 'e',
  title: 'Eating rate and adiposity',
  citation: 'Ohkuma 2015',
  studyType: 'meta_analysis',
  grade: 'moderate',
  summary: 'Faster eating is associated with higher BMI.',
  population: null,
  doi: null,
  pmid: null,
  relationship: 'supports',
  ...patch,
});

const SOURCES: SourceView[] = [
  source({ id: 'sunni', tradition: 'sunni', citationText: 'Bukhari 5376' }),
  source({ id: 'shia', tradition: 'shia', grade: 'muwaththaq', citationText: 'al-Kafi 6/269' }),
  source({ id: 'quran', kind: 'quran', grade: null, gradedBy: null, citationText: 'al-Araf 7:31' }),
  source({ id: 'shared', citationText: 'Tirmidhi 2380' }),
  source({ id: 'fake', grade: 'mawdu', citationText: 'Fabricated' }),
  source({ id: 'weak-support', grade: 'daif', citationText: 'Weak as support' }),
  source({ id: 'weak-context', grade: 'daif', relationship: 'context', citationText: 'Weak ctx' }),
];

describe('knowledge display rules (13 §5 to §7)', () => {
  it('shows shared sources to everyone plus only the user’s own tradition', () => {
    expect(visibleTraditions('sunni')).toEqual(['shared', 'sunni']);
    expect(visibleTraditions('shia')).toEqual(['shared', 'shia']);
    expect(visibleTraditions(null)).toEqual(['shared']);
    const sunni = sourcesForDisplay(SOURCES, 'sunni', 10).map((s) => s.id);
    expect(sunni).toContain('sunni');
    expect(sunni).not.toContain('shia');
    const shia = sourcesForDisplay(SOURCES, 'shia', 10).map((s) => s.id);
    expect(shia).toContain('shia');
    expect(shia).not.toContain('sunni');
  });

  it('never shows fabricated narrations and shows weak ones only as context', () => {
    expect(isDisplayable({ grade: 'mawdu', relationship: 'context' })).toBe(false);
    expect(isDisplayable({ grade: 'daif', relationship: 'supports' })).toBe(false);
    expect(isDisplayable({ grade: 'daif', relationship: 'context' })).toBe(true);
    expect(isDisplayable({ grade: null, relationship: 'supports' })).toBe(true);
    const ids = sourcesForDisplay(SOURCES, 'sunni', 10).map((s) => s.id);
    expect(ids).not.toContain('fake');
    expect(ids).not.toContain('weak-support');
    expect(ids[ids.length - 1]).toBe('weak-context');
  });

  it('puts the Qur’an first among supporting sources and caps at three', () => {
    const shown = sourcesForDisplay(SOURCES, 'sunni');
    expect(shown).toHaveLength(3);
    expect(shown[0]?.id).toBe('quran');
  });

  it('orders research by GRADE strength and caps at two', () => {
    const shown = evidenceForDisplay([
      study({ id: 'low', grade: 'low' }),
      study({ id: 'high', grade: 'high' }),
      study({ id: 'mod', grade: 'moderate' }),
    ]);
    expect(shown.map((e) => e.id)).toEqual(['high', 'mod']);
    expect(gradeDots('high')).toBe(4);
    expect(gradeDots('expert_opinion')).toBe(0);
  });

  it('picks the locale from i18n json with an English fallback', () => {
    expect(pickLocale({ en: 'Water', ur: 'پانی' }, 'ur')).toBe('پانی');
    expect(pickLocale({ en: 'Water' }, 'ur')).toBe('Water');
    expect(pickLocale(null, 'en')).toBe('');
  });
});

describe('knowledge components', () => {
  const rec: RecommendationView = {
    id: 'r1',
    code: 'eat_slowly',
    title: 'Eat slowly',
    practical: 'Put the spoon down between bites.',
    sources: SOURCES,
    evidence: [study({ id: 'e1' })],
  };

  it('renders the three parts with grade labels that name the grader', async () => {
    const onOpenDetail = jest.fn();
    const onOpenSource = jest.fn();
    await renderWithProviders(
      <RecommendationCard
        recommendation={rec}
        tradition="sunni"
        onOpenDetail={onOpenDetail}
        onOpenSource={onOpenSource}
        testID="rec"
      />,
    );
    expect(screen.getByText('What to do')).toBeTruthy();
    expect(screen.getByText('Put the spoon down between bites.')).toBeTruthy();
    expect(screen.getByTestId('rec.sources')).toBeTruthy();
    expect(screen.queryByTestId('rec.source.shia')).toBeNull();
    expect(screen.queryByTestId('rec.source.fake')).toBeNull();
    expect(screen.getAllByText('Sahih (authentic), graded by al-Albani').length).toBeGreaterThan(0);
    expect(screen.getByText('Moderate evidence')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rec.source.quran'));
    expect(onOpenSource).toHaveBeenCalledWith('quran');
    await fireEvent.press(screen.getByTestId('rec.details'));
    expect(onOpenDetail).toHaveBeenCalledWith('r1');
  });

  it('shows who verified a source', async () => {
    await renderWithProviders(<SourceCard source={SOURCES[3]!} testID="src" />);
    expect(screen.getByTestId('src.verified')).toHaveTextContent(
      'Checked by Mufti A on 2026-09-01',
    );
    expect(screen.getByText('Shared source')).toBeTruthy();
  });

  it('explains pending scholar review when nothing is verified yet', async () => {
    await renderWithProviders(<KnowledgeEmptyState />, { locale: 'ur' });
    expect(screen.getByTestId('knowledge.empty')).toHaveTextContent(/حوالہ جات کا جائزہ جاری ہے/);
  });
});
