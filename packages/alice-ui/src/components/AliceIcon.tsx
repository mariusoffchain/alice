import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { ALICE_ICON_SVG } from './alice-icon-svg';

type Props = {
  size?: number;
  color?: string;
};

export const AliceIcon = memo(function AliceIcon({ size = 24, color = '#8cbffc' }: Props) {
  const xml = useMemo(() => ALICE_ICON_SVG.replaceAll('{{COLOR}}', color), [color]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
