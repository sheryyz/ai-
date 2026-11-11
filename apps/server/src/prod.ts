// Cross-platform production entry (Windows cmd cannot do `NODE_ENV=production cmd`).
process.env.NODE_ENV = 'production'
await import('./index')

export {}
