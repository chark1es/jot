import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export type GlyphName =
  | 'notes'
  | 'search'
  | 'settings'
  | 'back'
  | 'new'
  | 'compose'
  | 'more'
  | 'sort'
  | 'folders'
  | 'undo'
  | 'redo'
  | 'check'
  | 'pin'
  | 'archive'
  | 'trash'
  | 'restore'
  | 'tag'
  | 'history'
  | 'share'
  | 'chevron'
  | 'close';

type IonName = ComponentProps<typeof Ionicons>['name'];

const IDLE: Record<GlyphName, IonName> = {
  notes: 'document-text-outline',
  search: 'search-outline',
  settings: 'settings-outline',
  back: Platform.OS === 'android' ? 'arrow-back' : 'chevron-back',
  new: 'add',
  compose: 'create-outline',
  more: Platform.OS === 'android' ? 'ellipsis-vertical' : 'ellipsis-horizontal-circle-outline',
  sort: 'swap-vertical',
  folders: 'folder-outline',
  undo: 'arrow-undo-outline',
  redo: 'arrow-redo-outline',
  check: 'checkmark',
  pin: 'pin-outline',
  archive: 'archive-outline',
  trash: 'trash-outline',
  restore: 'refresh-outline',
  tag: 'pricetag-outline',
  history: 'time-outline',
  share: 'share-outline',
  chevron: 'chevron-forward',
  close: 'close',
};

const ACTIVE: Record<GlyphName, IonName> = {
  ...IDLE,
  notes: 'document-text',
  search: 'search',
  settings: 'settings',
  folders: 'folder',
  pin: 'pin',
  tag: 'pricetag',
};

type Props = {
  readonly name: GlyphName;
  readonly color: ColorValue;
  readonly focused?: boolean;
  readonly size?: number;
};

export function Glyph({ name, color, focused = false, size = 22 }: Props) {
  return <Ionicons name={focused ? ACTIVE[name] : IDLE[name]} size={size} color={color} />;
}
