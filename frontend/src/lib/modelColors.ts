export const MODEL_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#f97316']

export function modelColor(name: string, fallbackIndex = 0): string {
  const value = name.trim().toLowerCase()
  if (!value) return MODEL_COLORS[Math.abs(fallbackIndex) % MODEL_COLORS.length]

  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return MODEL_COLORS[hash % MODEL_COLORS.length]
}
