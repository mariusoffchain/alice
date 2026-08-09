import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { CLOCK_ICON_SVG } from './clock-icon-svg';

type Props = {
  size?: number;
  color?: string;
};

export const ClockIcon = memo(function ClockIcon({ size = 24, color = '#8cbffc' }: Props) {
  const xml = useMemo(() => CLOCK_ICON_SVG.replaceAll('{{COLOR}}', color), [color]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
