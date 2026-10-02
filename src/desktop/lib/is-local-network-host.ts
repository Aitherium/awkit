export function isLocalNetworkHost(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')

    if (!normalized) return false
    if (normalized === 'localhost' || normalized === '::1') return true
    if (normalized.startsWith('127.')) return true
    if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true
    if (normalized.endsWith('.local')) return true
    if (!normalized.includes('.')) return true

    return false
}