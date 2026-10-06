import { REPORT_REASONS, reportTargetColumns } from '../api/source-reports-api';

describe('source reports', () => {
  it('sets exactly one target column', () => {
    expect(reportTargetColumns({ islamicSourceId: 'a' })).toEqual({
      islamic_source_id: 'a',
      scientific_evidence_id: null,
      recommendation_id: null,
      kind: 'islamic',
    });
    expect(reportTargetColumns({ scientificEvidenceId: 'b' })?.kind).toBe('scientific');
    expect(reportTargetColumns({ recommendationId: 'c', islamicSourceId: 'a' })).toMatchObject({
      recommendation_id: 'c',
      islamic_source_id: null,
      kind: 'recommendation',
    });
    expect(reportTargetColumns({})).toBeNull();
  });

  it('offers the review reasons', () => {
    expect(REPORT_REASONS).toContain('wrong_citation');
    expect(REPORT_REASONS).toContain('other');
  });
});
