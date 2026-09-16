import { describe, expect, it } from 'vitest'
import { defaultAuthenticatedPath, safeInternalRedirect } from './navigation'

describe('safe internal redirect', () => {
  it('uses only a valid bound team for the account default destination', () => {
    expect(defaultAuthenticatedPath({ role: 'TEAM', team_id: 3 })).toBe('/team-workspaces/3')
    expect(defaultAuthenticatedPath({ role: 'TEAM', team_id: null })).toBe('/')
    expect(defaultAuthenticatedPath({ role: 'TEAM', team_id: 'oops' })).toBe('/')
    expect(defaultAuthenticatedPath({ role: 'ADMIN', team_id: 3 })).toBe('/')
    expect(safeInternalRedirect('/material-trace?serial_no=A', '/team-workspaces/3')).toBe('/material-trace?serial_no=A')
  })

  it('preserves an internal path, query and hash', () => {
    expect(safeInternalRedirect('/transfer-batches/scan?mode=receive#batch')).toBe('/transfer-batches/scan?mode=receive#batch')
  })

  it.each([
    undefined, null, ['//evil.example'], 'https://evil.example', '//evil.example', '/\\evil.example',
    '/%5cevil.example', '/%2f%2fevil.example', '/\nevil.example', '/%0aevil.example', '/%ZZ',
    '/login', '/login?redirect=/login', '/access', '/access/',
  ])('rejects unsafe or looping target %j', (value) => {
    expect(safeInternalRedirect(value)).toBe('/transfer-batches')
  })
})
