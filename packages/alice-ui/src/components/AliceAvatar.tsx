import { memo, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { ALICE_AVATAR_SVG } from './alice-avatar-svg';

type Props = {
  size?: number;
  color?: string;
};

export const AliceAvatar = memo(function AliceAvatar({ size = 96, color = '#8cbffc' }: Props) {
  const xml = useMemo(() => ALICE_AVATAR_SVG.replaceAll('#8cbffc', color), [color]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
