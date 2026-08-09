import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { LOCK_ICON_SVG } from './lock-icon-svg';

type Props = {
  size?: number;
  color?: string;
};

export const LockIcon = memo(function LockIcon({ size = 36, color = '#7fabfd' }: Props) {
  const xml = useMemo(() => LOCK_ICON_SVG.replaceAll('{{COLOR}}', color), [color]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
