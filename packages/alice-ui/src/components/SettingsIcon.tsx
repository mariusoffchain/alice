import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { SETTINGS_SVG } from './settings-icon-svg';

type Props = {
  size?: number;
  color?: string;
};

export const SettingsIcon = memo(function SettingsIcon({ size = 32, color = '#8cbffc' }: Props) {
  const xml = useMemo(() => SETTINGS_SVG.replaceAll('{{COLOR}}', color), [color]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
