import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { FamilyMembersEditor } from '../components/family-members-editor';
import { useFamilyMembers } from '../hooks/use-family-members';

jest.mock('../hooks/use-family-members', () => ({
  useFamilyMembers: jest.fn(),
  useRemoveFamilyMember: jest.fn(() => ({ mutate: jest.fn(), isError: false, error: null })),
}));

const membersMock = useFamilyMembers as jest.Mock;

/** Launch follow-up: the Family roster says it is loading and offers a retry when it fails. */
describe('FamilyMembersEditor loading and error states', () => {
  it('shows a labelled loading row and no empty text while loading', async () => {
    membersMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    await renderWithProviders(<FamilyMembersEditor householdId="h1" source="family" canEdit />);
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeTruthy();
    expect(screen.queryByTestId('family-members.empty')).toBeNull();
  });

  it('offers Try again when the roster fails to load', async () => {
    const refetch = jest.fn(() => Promise.resolve());
    membersMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error('offline'),
      refetch,
    });
    await renderWithProviders(<FamilyMembersEditor householdId="h1" source="family" canEdit />);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
