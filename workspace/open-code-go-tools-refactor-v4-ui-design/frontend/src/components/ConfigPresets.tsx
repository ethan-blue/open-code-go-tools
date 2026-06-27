import { memo, useState } from 'react'
import { Rocket, Code, Pen, FlaskConical } from 'lucide-react'
import { useI18n } from '@/i18n'

interface Preset {
  id: string
  name: string
  icon: React.ReactNode
  description: string
  defaultModel: string
  modelAliases: Record<string, string>
}

const PRESETS: Preset[] = [
  {
    id: 'quickstart',
    name: '快速开始',
    icon: <Rocket width={16} height={16} />,
    description: '开箱即用，3 分钟搞定',
    defaultModel: 'kimi-k2.6',
    modelAliases: { sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-flash', opus: 'kimi-k2.6' },
  },
  {
    id: 'developer',
    name: '开发者',
    icon: <Code width={16} height={16} />,
    description: '代码优化，编程专用',
    defaultModel: 'deepseek-v4-pro',
    modelAliases: { sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-flash', opus: 'kimi-k2.6' },
  },
  {
    id: 'writing',
    name: '写作',
    icon: <Pen width={16} height={16} />,
    description: '文本生成，写作专用',
    defaultModel: 'qwen3.6-plus',
    modelAliases: { sonnet: 'qwen3.6-plus', haiku: 'deepseek-v4-flash', opus: 'kimi-k2.6' },
  },
  {
    id: 'research',
    name: '研究',
    icon: <FlaskConical width={16} height={16} />,
    description: '深度思考，分析专用',
    defaultModel: 'mimo-v2.5-pro',
    modelAliases: { sonnet: 'mimo-v2.5-pro', haiku: 'deepseek-v4-flash', opus: 'kimi-k2.6' },
  },
]

interface ConfigPresetsProps {
  onSelect: (preset: Preset) => void
  currentPreset?: string
}

export const ConfigPresets = memo(function ConfigPresets({ onSelect, currentPreset }: ConfigPresetsProps) {
  const { t } = useI18n()

  return (
    <div className="config-presets">
      <div className="presets-header">
        <h3>{t('config_presets_title')}</h3>
        <p className="muted">{t('config_presets_desc')}</p>
      </div>
      <div className="presets-grid">
        {PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={`preset-card ${currentPreset === preset.id ? 'active' : ''}`}
            onClick={() => onSelect(preset)}
          >
            <div className="preset-icon">{preset.icon}</div>
            <div className="preset-info">
              <b>{preset.name}</b>
              <span className="muted">{preset.description}</span>
            </div>
            <button className="btn btn-sm btn-ghost">
              {t('config_preset_use')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
})

export type { Preset }
export { PRESETS }
