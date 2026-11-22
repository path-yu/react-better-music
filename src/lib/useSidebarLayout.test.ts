import { describe, expect, it } from 'vitest'
import { nextSidebarPrefs, resolveSidebarCollapsed } from './useSidebarLayout'

const prefs = (sidebarCollapsed: boolean, sidebarAutoCollapse: boolean) => ({
  sidebarCollapsed,
  sidebarAutoCollapse,
})

describe('sidebar auto collapse', () => {
  it('collapses only narrow windows while automatic collapsing is on', () => {
    expect(resolveSidebarCollapsed(prefs(false, true), true)).toBe(true)
    expect(resolveSidebarCollapsed(prefs(false, true), false)).toBe(false)
    expect(resolveSidebarCollapsed(prefs(false, false), true)).toBe(false)
    expect(resolveSidebarCollapsed(prefs(true, false), false)).toBe(true)
  })

  it('remembers an expand made in a narrow window', () => {
    const next = nextSidebarPrefs(prefs(false, true), true)
    expect(next).toEqual(prefs(false, false))
    expect(resolveSidebarCollapsed(next, true)).toBe(false)
  })

  it('keeps automatic collapsing when expanding a wide window', () => {
    expect(nextSidebarPrefs(prefs(true, true), false)).toEqual(prefs(false, true))
  })

  it('collapses manually from an expanded sidebar', () => {
    expect(nextSidebarPrefs(prefs(false, false), true)).toEqual(prefs(true, false))
    expect(nextSidebarPrefs(prefs(false, true), false)).toEqual(prefs(true, true))
  })
})
