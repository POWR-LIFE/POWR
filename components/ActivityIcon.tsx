import type { ActivityConfig } from '@/constants/activities';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

interface ActivityIconProps {
  activity: ActivityConfig;
  size: number;
  color: string;
  active?: boolean;
  style?: any;
}

export function ActivityIcon({ activity, size, color, active = true, style }: ActivityIconProps) {
  const name = active ? activity.iconActive : activity.icon;

  if (activity.iconLib === 'material-community') {
    return <MaterialCommunityIcons name={name as any} size={size} color={color} style={style} />;
  }

  return <Ionicons name={name as any} size={size} color={color} style={style} />;
}
