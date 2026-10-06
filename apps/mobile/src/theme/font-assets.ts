import InterRegular from '@assets/fonts/Inter-Regular.ttf';
import InterMedium from '@assets/fonts/Inter-Medium.ttf';
import InterSemiBold from '@assets/fonts/Inter-SemiBold.ttf';
import InterBold from '@assets/fonts/Inter-Bold.ttf';
import InterDisplaySemiBold from '@assets/fonts/InterDisplay-SemiBold.ttf';
import NotoNastaliqUrduRegular from '@assets/fonts/NotoNastaliqUrdu-Regular.ttf';
import NotoNastaliqUrduBold from '@assets/fonts/NotoNastaliqUrdu-Bold.ttf';
import AmiriRegular from '@assets/fonts/Amiri-Regular.ttf';
import AmiriBold from '@assets/fonts/Amiri-Bold.ttf';
import AmiriQuranRegular from '@assets/fonts/AmiriQuran-Regular.ttf';

import { fontFamilies } from './tokens';

/** Bundled font files keyed by PostScript name (03 §5.1); loaded by SplashGate. */
export const FONT_ASSETS = {
  [fontFamilies.ui[400]]: InterRegular,
  [fontFamilies.ui[500]]: InterMedium,
  [fontFamilies.ui[600]]: InterSemiBold,
  [fontFamilies.ui[700]]: InterBold,
  [fontFamilies.ui.display600]: InterDisplaySemiBold,
  [fontFamilies.urdu[400]]: NotoNastaliqUrduRegular,
  [fontFamilies.urdu[700]]: NotoNastaliqUrduBold,
  [fontFamilies.arabic[400]]: AmiriRegular,
  [fontFamilies.arabic[700]]: AmiriBold,
  [fontFamilies.quran[400]]: AmiriQuranRegular,
} as const;
