'use client'

import { useState, useEffect, useCallback } from 'react'
import styles from './UsageDashboard.module.css'

interface UsageMetric {
  current: number
  limit: number
  percent: number
}

interface UsageResponse {
  tenant_id: string
  license: {
    status: string
    max_agents: number
    max_daily_tool_calls: number
    max_monthly_tokens: number
    expires_at?: string
  }
  usage: {
    tool_calls: UsageMetric
    agents_active: UsageMetric
    tokens_consumed: UsageMetric
  }
  warnings: string[]
  within_limits: boolean
  upgrade_url: string
}

interface DailySnapshot {
  date: string
  tool_calls: number
  agents_active: number
  tokens_consumed: number
}

interface HistoryResponse {
  tenant_id: string
  period: {
    start: string
    end: string
    days: number
  }
  daily_snapshots: DailySnapshot[]
  summary: {
    total_tool_calls: number
    avg_daily_tool_calls: number
    total_agents: number
    total_tokens: number
    peak_concurrent_agents: number
  }
  top_tools: Array<{ name: string; calls: number }>
}

type TimePeriod = 'today' | 'week' | 'month'

interface UsageDashboardProps {
  apiBase?: string
  tenantId?: string
}

/**
 * UsageDashboard — Real-time usage tracking against license limits.
 *
 * Features:
 *  - Progress bars for each metric (color-coded: green <60%, yellow 60-80%, red >80%)
 *  - Current usage vs. limits
 *  - Historical trends (daily snapshots)
 *  - Top tools breakdown
 *  - Upgrade CTA when approaching limits
 *  - Daily/weekly/monthly toggle
 */
export default function UsageDashboard({
  apiBase = '/api/platform',
  tenantId,
}: UsageDashboardProps = {}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Current usage
  const [usage, setUsage] = useState<UsageResponse | null>(null)

  // Historical data
  const [history, setHistory] = useState<HistoryResponse | null>(null)

  // UI controls
  const [period, setPeriod] = useState<TimePeriod>('today')
  const [refreshInterval, setRefreshInterval] = useState<number | null>(5000) // 5s

  // Fetch current usage
  const fetchUsage = useCallback(async () => {
    try {
      const url = new URL(`${apiBase}/v1/marketplace/usage`, window.location.origin)
      if (tenantId) {
        url.searchParams.set('tenant_id', tenantId)
      }

      const resp = await fetch(url.toString())
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      }

      const data: UsageResponse = await resp.json()
      setUsage(data)
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Failed to load usage: ${msg}`)
    }
  }, [apiBase, tenantId])

  // Fetch historical data
  const fetchHistory = useCallback(async () => {
    try {
      const days = period === 'today' ? 1 : period === 'week' ? 7 : 30
      const url = new URL(`${apiBase}/v1/marketplace/usage/history`, window.location.origin)
      if (tenantId) {
        url.searchParams.set('tenant_id', tenantId)
      }
      url.searchParams.set('days', String(days))

      const resp = await fetch(url.toString())
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      }

      const data: HistoryResponse = await resp.json()
      setHistory(data)
    } catch (err) {
      // Don't override main error, just log
      console.error('Failed to load history:', err)
    }
  }, [apiBase, tenantId, period])

  // Initial load and setup auto-refresh
  useEffect(() => {
    setLoading(true)
    Promise.all([fetchUsage(), fetchHistory()]).finally(() => setLoading(false))
  }, [fetchUsage, fetchHistory])

  // Auto-refresh
  useEffect(() => {
    if (!refreshInterval) return
    const timer = setInterval(() => {
      fetchUsage()
    }, refreshInterval)
    return () => clearInterval(timer)
  }, [refreshInterval, fetchUsage])

  if (loading && !usage) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading usage data...</div>
      </div>
    )
  }

  if (error && !usage) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h1>Usage & License Dashboard</h1>
        <div className={styles.headerControls}>
          <div className={styles.refreshControl}>
            <label htmlFor="refresh-interval">Auto-refresh:</label>
            <select
              id="refresh-interval"
              value={refreshInterval ?? 'none'}
              onChange={(e) => setRefreshInterval(e.target.value === 'none' ? null : parseInt(e.target.value))}
            >
              <option value="none">Off</option>
              <option value="5000">5 seconds</option>
              <option value="10000">10 seconds</option>
              <option value="30000">30 seconds</option>
              <option value="60000">1 minute</option>
            </select>
          </div>
          <button onClick={fetchUsage} disabled={loading} className={styles.refreshBtn}>
            {loading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>
      </div>

      {/* Status & License Info */}
      {usage && (
        <div className={styles.licenseInfo}>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.label}>License Status:</span>
              <span className={`${styles.value} ${styles[`status-${usage.license.status}`]}`}>
                {usage.license.status.toUpperCase()}
              </span>
            </div>
            {usage.license.expires_at && (
              <div className={styles.infoItem}>
                <span className={styles.label}>Expires:</span>
                <span className={styles.value}>
                  {new Date(usage.license.expires_at).toLocaleDateString()}
                </span>
              </div>
            )}
            {!usage.within_limits && (
              <div className={styles.infoItem}>
                <a href={usage.upgrade_url} className={styles.upgradeBtn}>
                  Upgrade Now
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Warnings */}
      {usage?.warnings && usage.warnings.length > 0 && (
        <div className={`${styles.warnings} ${!usage.within_limits ? styles.error : styles.warning}`}>
          <h3>Usage Alerts:</h3>
          <ul>
            {usage.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Metrics Grid */}
      {usage && (
        <div className={styles.metricsGrid}>
          {/* Tool Calls */}
          <MetricCard
            title="Daily Tool Calls"
            metric={usage.usage.tool_calls}
            icon="⚙️"
            color={getColor(usage.usage.tool_calls.percent)}
          />

          {/* Agents */}
          <MetricCard
            title="Active Agents (Monthly)"
            metric={usage.usage.agents_active}
            icon="🤖"
            color={getColor(usage.usage.agents_active.percent)}
          />

          {/* Tokens */}
          <MetricCard
            title="Tokens Consumed (Monthly)"
            metric={usage.usage.tokens_consumed}
            icon="💬"
            color={getColor(usage.usage.tokens_consumed.percent)}
          />
        </div>
      )}

      {/* Historical Trends */}
      {history && (
        <div className={styles.historySection}>
          <div className={styles.historyHeader}>
            <h2>Usage Trends</h2>
            <div className={styles.periodToggle}>
              <button
                className={period === 'today' ? styles.active : ''}
                onClick={() => setPeriod('today')}
              >
                Today
              </button>
              <button
                className={period === 'week' ? styles.active : ''}
                onClick={() => setPeriod('week')}
              >
                This Week
              </button>
              <button
                className={period === 'month' ? styles.active : ''}
                onClick={() => setPeriod('month')}
              >
                This Month
              </button>
            </div>
          </div>

          {/* Summary Stats */}
          <div className={styles.summaryStats}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Total Tool Calls</div>
              <div className={styles.statValue}>{history.summary.total_tool_calls}</div>
              <div className={styles.statSubtext}>
                Avg: {history.summary.avg_daily_tool_calls.toFixed(1)}/day
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Total Agents</div>
              <div className={styles.statValue}>{history.summary.total_agents}</div>
              <div className={styles.statSubtext}>Peak: {history.summary.peak_concurrent_agents}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Tokens Used</div>
              <div className={styles.statValue}>{history.summary.total_tokens.toLocaleString()}</div>
            </div>
          </div>

          {/* Daily Breakdown */}
          {history.daily_snapshots.length > 0 && (
            <div className={styles.dailyBreakdown}>
              <h3>Daily Breakdown</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Tool Calls</th>
                    <th>Agents</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {history.daily_snapshots.map((snap) => (
                    <tr key={snap.date}>
                      <td>{new Date(snap.date).toLocaleDateString()}</td>
                      <td>{snap.tool_calls}</td>
                      <td>{snap.agents_active}</td>
                      <td>{snap.tokens_consumed.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Top Tools */}
          {history.top_tools && history.top_tools.length > 0 && (
            <div className={styles.topTools}>
              <h3>Top Tools (Last 30 Days)</h3>
              <ul>
                {history.top_tools.map((tool) => (
                  <li key={tool.name}>
                    <span className={styles.toolName}>{tool.name}</span>
                    <span className={styles.toolCount}>{tool.calls} calls</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Export Section */}
      {usage && (
        <div className={styles.exportSection}>
          <h3>Export Data</h3>
          <div className={styles.exportButtons}>
            <button
              onClick={() => exportData('csv')}
              className={styles.exportBtn}
            >
              📥 Download CSV
            </button>
            <button
              onClick={() => exportData('json')}
              className={styles.exportBtn}
            >
              📥 Download JSON
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * MetricCard — Individual usage metric with progress bar.
 */
function MetricCard({
  title,
  metric,
  icon,
  color,
}: {
  title: string
  metric: UsageMetric
  icon: string
  color: string
}) {
  const isCapped = metric.limit === 0
  const displayPercent = isCapped ? 0 : metric.percent

  return (
    <div className={`${styles.metricCard} ${styles[`color-${color}`]}`}>
      <div className={styles.metricHeader}>
        <span className={styles.metricIcon}>{icon}</span>
        <h3 className={styles.metricTitle}>{title}</h3>
      </div>

      <div className={styles.metricValue}>
        {metric.current.toLocaleString()} / {metric.limit.toLocaleString()}
      </div>

      <div className={styles.progressBar}>
        <div
          className={`${styles.progress} ${styles[`bg-${color}`]}`}
          style={{ width: `${Math.min(displayPercent, 100)}%` }}
        />
      </div>

      <div className={styles.metricPercent}>
        {isCapped ? 'Unlimited' : `${displayPercent.toFixed(1)}%`}
      </div>

      {metric.percent >= 100 && (
        <div className={styles.metricWarning}>⚠️ Limit exceeded</div>
      )}
      {metric.percent >= 80 && metric.percent < 100 && (
        <div className={styles.metricWarning}>⚠️ Approaching limit</div>
      )}
    </div>
  )
}

/**
 * Determine color based on usage percentage.
 */
function getColor(percent: number): 'green' | 'yellow' | 'red' {
  if (percent >= 80) return 'red'
  if (percent >= 60) return 'yellow'
  return 'green'
}

/**
 * Export usage data.
 */
async function exportData(format: 'csv' | 'json') {
  try {
    const tenantId = new URLSearchParams(window.location.search).get('tenant_id') || undefined
    const url = new URL('/api/platform/v1/marketplace/usage/export', window.location.origin)
    if (tenantId) {
      url.searchParams.set('tenant_id', tenantId)
    }
    url.searchParams.set('format', format)

    const resp = await fetch(url.toString())
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }

    const data = await resp.json()

    if (format === 'csv') {
      // Build CSV from response
      const headers = data.headers.join(',')
      const rows = data.rows.map((r: any) => data.headers.map((h: string) => r[h]).join(','))
      const csv = [headers, ...rows].join('\n')
      downloadFile(csv, 'usage.csv', 'text/csv')
    } else {
      const json = JSON.stringify(data, null, 2)
      downloadFile(json, 'usage.json', 'application/json')
    }
  } catch (err) {
    alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Helper to download a file.
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
