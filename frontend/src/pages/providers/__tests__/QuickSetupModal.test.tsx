import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickSetupModal, parsePastedKeys } from '../QuickSetupModal'
import type { ProviderAccount } from '@/lib/types'

const toastMock = vi.fn()

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

// Users paste keys from password managers / notes in messy formats; the
// parser must accept one-per-line AND comma/semicolon lists, and silently
// drop duplicates so an account never appears twice in the rotation pool.
describe('parsePastedKeys', () => {
  it('splits on newlines, commas and semicolons, trimming whitespace', () => {
    expect(parsePastedKeys('sk-a\n sk-b ,sk-c;sk-d\n')).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-d'])
  })

  it('deduplicates and drops empty segments', () => {
    expect(parsePastedKeys('sk-a\n\nsk-a,,sk-b')).toEqual(['sk-a', 'sk-b'])
  })
})

describe('QuickSetupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 一键配置现在的职责就是把粘贴的 key 追加到账号池，不再自己调 API。
  // 验证 onImport 收到正确数量的账号，且 label 从 startIndex 起编号。
  it('hands pasted keys to onImport as labelled accounts', async () => {
    const onImport = vi.fn()
    const onClose = vi.fn()
    render(<QuickSetupModal startIndex={2} onClose={onClose} onImport={onImport} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sk-one\nsk-two' } })
    fireEvent.click(screen.getByRole('button', { name: /prov_quick_setup_apply/ }))

    await waitFor(() => expect(onImport).toHaveBeenCalled())
    const imported = onImport.mock.calls[0][0] as ProviderAccount[]
    expect(imported).toHaveLength(2)
    expect(imported.map(a => a.apiKey)).toEqual(['sk-one', 'sk-two'])
    // startIndex=2 → 第一个新账号 label 编号 3
    expect(imported[0].label).toContain('3')
    expect(imported[1].label).toContain('4')
    expect(onClose).toHaveBeenCalled()
  })

  // Empty input must never fire onImport — guard against wiping/zeroing the pool.
  it('refuses to apply with no keys', () => {
    const onImport = vi.fn()
    render(<QuickSetupModal startIndex={0} onClose={() => {}} onImport={onImport} />)
    const apply = screen.getByRole('button', { name: /prov_quick_setup_apply/ })
    expect(apply).toBeDisabled()
    expect(onImport).not.toHaveBeenCalled()
  })

  // startIndex=0 用于空账号池的首次导入，label 应从 1 开始编号。
  it('labels accounts starting from 1 when the pool is empty', async () => {
    const onImport = vi.fn()
    render(<QuickSetupModal startIndex={0} onClose={() => {}} onImport={onImport} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sk-only' } })
    fireEvent.click(screen.getByRole('button', { name: /prov_quick_setup_apply/ }))

    await waitFor(() => expect(onImport).toHaveBeenCalled())
    const imported = onImport.mock.calls[0][0] as ProviderAccount[]
    expect(imported[0].label).toContain('1')
  })
})
