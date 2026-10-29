import type { Palette, Theme } from '../store/ui'

export interface PaletteOption {
  id: Palette
  label: string
  description: string
  light: { accent: string; surface: string; background: string }
  dark: { accent: string; surface: string; background: string }
}

/**
 * Three built-in palettes. Each one carries its own accent and tinted surfaces;
 * the CSS in styles.css maps them onto both the light and dark theme variables.
 */
export const PALETTE_OPTIONS: PaletteOption[] = [
  {
    id: 'ocean',
    label: '海盐蓝',
    description: '清透的蓝色，接近系统默认',
    light: { accent: '#0066cc', surface: '#ffffff', background: '#f5f5f7' },
    dark: { accent: '#2997ff', surface: '#232325', background: '#1c1c1e' },
  },
  {
    id: 'sunset',
    label: '落日橙',
    description: '温暖的琥珀色，适合夜间使用',
    light: { accent: '#b45309', surface: '#fffdf9', background: '#fbf3e8' },
    dark: { accent: '#fb923c', surface: '#241b13', background: '#1b1511' },
  },
  {
    id: 'forest',
    label: '苔原绿',
    description: '低饱和的青绿，安静耐看',
    light: { accent: '#0f766e', surface: '#fbfdfc', background: '#eef5f1' },
    dark: { accent: '#2dd4bf', surface: '#14241c', background: '#122019' },
  },
  {
    id: 'sakura',
    label: '樱花粉',
    description: '柔和的粉色，轻盈浪漫',
    light: { accent: '#be185d', surface: '#fffafc', background: '#fdf2f8' },
    dark: { accent: '#f472b6', surface: '#24161d', background: '#1f1118' },
  },
  {
    id: 'violet',
    label: '葡萄紫',
    description: '低饱和紫罗兰，安静有质感',
    light: { accent: '#6d28d9', surface: '#fbf9ff', background: '#f5f3ff' },
    dark: { accent: '#a78bfa', surface: '#201a2c', background: '#1b1626' },
  },
  {
    id: 'teal',
    label: '深海青',
    description: '清冷的青蓝，适合专注',
    light: { accent: '#0e7490', surface: '#f8fdff', background: '#ecfeff' },
    dark: { accent: '#22d3ee', surface: '#10242a', background: '#0f1d22' },
  },
  {
    id: 'rose',
    label: '玫瑰红',
    description: '克制的玫瑰红，醒目但不刺眼',
    light: { accent: '#be123c', surface: '#fffafb', background: '#fff1f2' },
    dark: { accent: '#fb7185', surface: '#25171a', background: '#211316' },
  },
  {
    id: 'amber',
    label: '琥珀金',
    description: '温暖的琥珀金，明亮有活力',
    light: { accent: '#a16207', surface: '#fffdf4', background: '#fefce8' },
    dark: { accent: '#facc15', surface: '#221d12', background: '#1f1a10' },
  },
  {
    id: 'graphite',
    label: '石墨灰',
    description: '中性石墨灰，极简耐看',
    light: { accent: '#475569', surface: '#fbfcfd', background: '#f8fafc' },
    dark: { accent: '#cbd5e1', surface: '#1c1f25', background: '#16181d' },
  },
  {
    id: 'mocha',
    label: '咖啡棕',
    description: '温暖的咖啡棕，沉稳柔和',
    light: { accent: '#78350f', surface: '#fdf9f4', background: '#f7ede3' },
    dark: { accent: '#d4a373', surface: '#241a15', background: '#1d1512' },
  },
]

const META_COLORS: Record<Palette, Record<Theme, string>> = {
  ocean: { light: '#f5f5f7', dark: '#1c1c1e' },
  sunset: { light: '#fbf3e8', dark: '#1b1511' },
  forest: { light: '#eef5f1', dark: '#122019' },
  sakura: { light: '#fdf2f8', dark: '#1f1118' },
  violet: { light: '#f5f3ff', dark: '#1b1626' },
  teal: { light: '#ecfeff', dark: '#0f1d22' },
  rose: { light: '#fff1f2', dark: '#211316' },
  amber: { light: '#fefce8', dark: '#1f1a10' },
  graphite: { light: '#f8fafc', dark: '#16181d' },
  mocha: { light: '#f7ede3', dark: '#1d1512' },
}

export function applyTheme(theme: Theme, palette: Palette = 'ocean') {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-palette', palette)
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', META_COLORS[palette][theme])
}
