import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { ALICE_LOGO_SVG } from './alice-logo-svg';

type Props = {
  size?: number;
  color?: string;
};

export const AliceLogo = memo(function AliceLogo({ size = 44, color = '#7eabfd' }: Props) {
  const xml = useMemo(() => ALICE_LOGO_SVG.replaceAll('{{COLOR}}', color), [color]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
