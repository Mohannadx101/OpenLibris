import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, createAppUrlGuard } from '@main/security'

describe('buildContentSecurityPolicy', () => {
  const production = buildContentSecurityPolicy({ dev: false })

  it('only allows the bundled scripts in production', () => {
    expect(production).toContain("script-src 'self'")
    expect(production).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(production).not.toContain('unsafe-eval')
  })

  it('locks down plugins, forms and frames', () => {
    for (const directive of ["object-src 'none'", "form-action 'none'", "frame-src 'none'"]) {
      expect(production).toContain(directive)
    }
  })

  it('allows only what showing an EPUB needs: blob styles and fonts, and its own base tag', () => {
    // EPUB.js turns a book's stylesheets and fonts into blob URLs and adds a <base> tag.
    expect(production).toMatch(/style-src[^;]*blob:/)
    expect(production).toMatch(/font-src[^;]*blob:/)
    expect(production).toContain("base-uri 'self'")

    // ...and nothing else came along with it.
    expect(production).not.toMatch(/(script-src|default-src|connect-src)[^;]*blob:/)
    expect(production).not.toMatch(/img-src[^;]*\*/)
    expect(production).not.toMatch(/https?:\/\//)
  })

  it('lets the renderer read from the library scheme but not from the network', () => {
    expect(production).toMatch(/connect-src[^;]*book:/)
    expect(production).not.toMatch(/https?:\/\//)
    expect(production).not.toMatch(/ws:/)
  })

  it('allows only what hot reloading needs in development', () => {
    const dev = buildContentSecurityPolicy({ dev: true, devServerOrigin: 'http://localhost:5173' })
    expect(dev).toMatch(/script-src[^;]*unsafe-inline/)
    expect(dev).toContain('http://localhost:5173')
    expect(dev).toContain('ws://localhost:5173')
  })
})

describe('createAppUrlGuard', () => {
  const rendererFile = '/app/out/renderer/index.html'

  describe('in production', () => {
    const isAppUrl = createAppUrlGuard({ rendererFile })

    it('accepts the renderer page, with or without a hash route', () => {
      expect(isAppUrl('file:///app/out/renderer/index.html')).toBe(true)
      expect(isAppUrl('file:///app/out/renderer/index.html#/reader/abc')).toBe(true)
    })

    it('rejects other files and other schemes', () => {
      expect(isAppUrl('file:///etc/passwd')).toBe(false)
      expect(isAppUrl('file:///app/out/renderer/other.html')).toBe(false)
      expect(isAppUrl('https://example.com')).toBe(false)
      expect(isAppUrl('book://library/x')).toBe(false)
      expect(isAppUrl('')).toBe(false)
    })
  })

  describe('in development', () => {
    const isAppUrl = createAppUrlGuard({ devServerUrl: 'http://localhost:5173', rendererFile })

    it('accepts the dev server origin and nothing else on the web', () => {
      expect(isAppUrl('http://localhost:5173/#/')).toBe(true)
      expect(isAppUrl('http://localhost:9999/')).toBe(false)
      expect(isAppUrl('https://example.com')).toBe(false)
    })
  })
})
