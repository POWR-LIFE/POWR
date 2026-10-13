import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

// jest.setup.js initialises lib/i18n, so components render real English.
function Probe() {
  const { t } = useTranslation();
  return <Text>{t('settings:language.title')}</Text>;
}

it('renders English through useTranslation in tests', () => {
  render(<Probe />);
  expect(screen.getByText('Language')).toBeTruthy();
});
