import { avatarColor } from '@/lib/tokens';

export interface AvatarProps {
  /** Nom utilisé pour la première lettre + couleur déterministe si `color` n'est pas fourni. */
  name: string;
  /** Override couleur fond (sinon dérivée du nom). */
  color?: string;
  /** Taille en pixels. */
  size?: number;
  /** URL d'une image pour remplacer l'initiale. */
  src?: string;
}

export function Avatar({ name, color, size = 30, src }: AvatarProps) {
  const bg = color ?? avatarColor(name);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const radius = Math.round(size * 0.28);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: src ? `url(${src}) center/cover` : bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
      }}
    >
      {!src && initial}
    </div>
  );
}
