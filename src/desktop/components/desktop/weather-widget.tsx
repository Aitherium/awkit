'use client'

/**
 * Weather Widget
 * ==============
 *
 * Full weather application for AitherOS desktop.
 *
 * Features:
 *  - Current conditions (from wttr.in API — no key needed)
 *  - 3-day forecast
 *  - World clock (multiple timezones)
 *  - Location search
 *  - Animated weather icons
 *  - Temperature unit toggle (°C / °F)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, Wind,
  Droplets, Eye, Thermometer, Sunrise, Sunset, MapPin, Search,
  RefreshCw, Clock, Globe2, CloudFog, Umbrella
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface WeatherData {
  location: string
  country: string
  temp_c: number
  temp_f: number
  feels_like_c: number
  feels_like_f: number
  humidity: number
  wind_kph: number
  wind_dir: string
  visibility_km: number
  uv: number
  condition: string
  conditionCode: number
  pressure_mb: number
  precip_mm: number
  sunrise: string
  sunset: string
  forecast: ForecastDay[]
  hourly: HourlyData[]
}

interface ForecastDay {
  date: string
  maxtemp_c: number
  maxtemp_f: number
  mintemp_c: number
  mintemp_f: number
  condition: string
  conditionCode: number
  rain_chance: number
}

interface HourlyData {
  time: string
  temp_c: number
  temp_f: number
  condition: string
  conditionCode: number
  rain_chance: number
}

interface WorldClock {
  city: string
  timezone: string
  label: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const WORLD_CLOCKS: WorldClock[] = [
  { city: 'New York', timezone: 'America/New_York', label: 'EST' },
  { city: 'London', timezone: 'Europe/London', label: 'GMT' },
  { city: 'Tokyo', timezone: 'Asia/Tokyo', label: 'JST' },
  { city: 'Sydney', timezone: 'Australia/Sydney', label: 'AEST' },
  { city: 'Los Angeles', timezone: 'America/Los_Angeles', label: 'PST' },
  { city: 'Berlin', timezone: 'Europe/Berlin', label: 'CET' },
  { city: 'Dubai', timezone: 'Asia/Dubai', label: 'GST' },
  { city: 'Singapore', timezone: 'Asia/Singapore', label: 'SGT' },
]

// ============================================================================
// HELPERS
// ============================================================================

function getWeatherIcon(code: number, size = 'w-8 h-8') {
  // wttr.in codes: https://www.worldweatheronline.com/developer/api/docs/weather-icons.aspx
  const cls = size
  if (code === 113) return <Sun className={`${cls} text-amber-400`} />
  if (code === 116) return <Cloud className={`${cls} text-zinc-400`} />
  if ([119, 122].includes(code)) return <Cloud className={`${cls} text-zinc-500`} />
  if ([143, 248, 260].includes(code)) return <CloudFog className={`${cls} text-zinc-400`} />
  if ([176, 263, 266, 293, 296].includes(code)) return <CloudDrizzle className={`${cls} text-blue-400`} />
  if ([299, 302, 305, 308, 356, 359].includes(code)) return <CloudRain className={`${cls} text-blue-500`} />
  if ([200, 386, 389, 392, 395].includes(code)) return <CloudLightning className={`${cls} text-yellow-400`} />
  if ([179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 350, 353, 362, 365, 368, 371, 374, 377].includes(code))
    return <CloudSnow className={`${cls} text-sky-300`} />
  return <Cloud className={`${cls} text-zinc-500`} />
}

function dayName(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en', { weekday: 'short' })
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function WeatherWidget({ className = '' }: { className?: string }) {
  const [location, setLocation] = useState(() =>
    localStorage.getItem('aitheros-weather-location') || 'Stockholm'
  )
  const [searchInput, setSearchInput] = useState('')
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [useCelsius, setUseCelsius] = useState(true)
  const [tab, setTab] = useState<'weather' | 'forecast' | 'clocks'>('weather')
  const [clockTick, setClockTick] = useState(0)

  // Clock ticker
  useEffect(() => {
    const iv = setInterval(() => setClockTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  // Fetch weather from wttr.in (no API key needed)
  const fetchWeather = useCallback(async (loc: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(loc)}?format=j1`, {
        headers: { 'Accept': 'application/json' }
      })
      if (!res.ok) throw new Error('Location not found')
      const data = await res.json()

      const cur = data.current_condition?.[0] || {}
      const area = data.nearest_area?.[0] || {}
      const astro = data.weather?.[0]?.astronomy?.[0] || {}

      const wd: WeatherData = {
        location: area.areaName?.[0]?.value || loc,
        country: area.country?.[0]?.value || '',
        temp_c: parseFloat(cur.temp_C || '0'),
        temp_f: parseFloat(cur.temp_F || '0'),
        feels_like_c: parseFloat(cur.FeelsLikeC || '0'),
        feels_like_f: parseFloat(cur.FeelsLikeF || '0'),
        humidity: parseFloat(cur.humidity || '0'),
        wind_kph: parseFloat(cur.windspeedKmph || '0'),
        wind_dir: cur.winddir16Point || '',
        visibility_km: parseFloat(cur.visibility || '0'),
        uv: parseFloat(cur.uvIndex || '0'),
        condition: cur.weatherDesc?.[0]?.value || 'Unknown',
        conditionCode: parseInt(cur.weatherCode || '0'),
        pressure_mb: parseFloat(cur.pressure || '0'),
        precip_mm: parseFloat(cur.precipMM || '0'),
        sunrise: astro.sunrise || '',
        sunset: astro.sunset || '',
        forecast: (data.weather || []).slice(0, 3).map((d: any) => ({
          date: d.date,
          maxtemp_c: parseFloat(d.maxtempC || '0'),
          maxtemp_f: parseFloat(d.maxtempF || '0'),
          mintemp_c: parseFloat(d.mintempC || '0'),
          mintemp_f: parseFloat(d.mintempF || '0'),
          condition: d.hourly?.[4]?.weatherDesc?.[0]?.value || 'Unknown',
          conditionCode: parseInt(d.hourly?.[4]?.weatherCode || '0'),
          rain_chance: parseInt(d.hourly?.[4]?.chanceofrain || '0'),
        })),
        hourly: (data.weather?.[0]?.hourly || []).map((h: any) => ({
          time: `${String(parseInt(h.time) / 100).padStart(2, '0')}:00`,
          temp_c: parseFloat(h.tempC || '0'),
          temp_f: parseFloat(h.tempF || '0'),
          condition: h.weatherDesc?.[0]?.value || '',
          conditionCode: parseInt(h.weatherCode || '0'),
          rain_chance: parseInt(h.chanceofrain || '0'),
        })),
      }

      setWeather(wd)
      localStorage.setItem('aitheros-weather-location', loc)
    } catch (e: any) {
      setError(e.message || 'Failed to fetch weather')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWeather(location) }, [location, fetchWeather])

  const searchLocation = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      setLocation(searchInput.trim())
      setSearchInput('')
    }
  }, [searchInput])

  const t = (c: number, f: number) => useCelsius ? `${Math.round(c)}°C` : `${Math.round(f)}°F`

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/60 bg-zinc-900/50">
        {(['weather', 'forecast', 'clocks'] as const).map(tb => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors ${
              tab === tb ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {tb === 'clocks' ? '🌍 Clocks' : tb === 'forecast' ? '📅 Forecast' : '⛅ Now'}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setUseCelsius(!useCelsius)}
          className="px-2 py-0.5 rounded text-[10px] font-medium text-zinc-500 hover:text-zinc-300 bg-zinc-800/50">
          {useCelsius ? '°C' : '°F'}
        </button>
        <button onClick={() => fetchWeather(location)} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search bar */}
      <form onSubmit={searchLocation} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/30">
        <MapPin className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder={weather ? `${weather.location}, ${weather.country}` : 'Search location...'}
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
        />
        <button type="submit" className="p-1 text-zinc-500 hover:text-zinc-300"><Search className="w-3 h-3" /></button>
      </form>

      {error && <div className="px-4 py-3 text-red-400 text-sm text-center">{error}</div>}

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-none">
        {loading && !weather ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-8 h-8 text-zinc-700 animate-spin" />
          </div>
        ) : weather && tab === 'weather' ? (
          <div className="p-4 space-y-4">
            {/* Current conditions hero */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-5xl font-bold text-white tabular-nums">
                  {t(weather.temp_c, weather.temp_f)}
                </div>
                <div className="text-sm text-zinc-500 mt-1">
                  Feels like {t(weather.feels_like_c, weather.feels_like_f)}
                </div>
                <div className="text-sm text-zinc-400 mt-0.5">{weather.condition}</div>
              </div>
              <div className="flex flex-col items-center">
                {getWeatherIcon(weather.conditionCode, 'w-16 h-16')}
              </div>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Droplets, label: 'Humidity', value: `${weather.humidity}%`, color: 'text-blue-400' },
                { icon: Wind, label: 'Wind', value: `${weather.wind_kph} km/h ${weather.wind_dir}`, color: 'text-cyan-400' },
                { icon: Eye, label: 'Visibility', value: `${weather.visibility_km} km`, color: 'text-green-400' },
                { icon: Umbrella, label: 'Precip', value: `${weather.precip_mm} mm`, color: 'text-blue-300' },
                { icon: Thermometer, label: 'Pressure', value: `${weather.pressure_mb} mb`, color: 'text-amber-400' },
                { icon: Sun, label: 'UV Index', value: String(weather.uv), color: 'text-yellow-400' },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="p-2 rounded-lg bg-zinc-800/30 border border-zinc-800/40">
                  <div className="flex items-center gap-1 mb-1">
                    <Icon className={`w-3 h-3 ${color}`} />
                    <span className="text-[10px] text-zinc-600">{label}</span>
                  </div>
                  <div className="text-xs text-zinc-300 font-medium">{value}</div>
                </div>
              ))}
            </div>

            {/* Sunrise / Sunset */}
            <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-zinc-800/20 border border-zinc-800/30">
              <div className="flex items-center gap-1.5">
                <Sunrise className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-zinc-400">{weather.sunrise}</span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 via-amber-500/10 to-[#5EC9CC]/30" />
              <div className="flex items-center gap-1.5">
                <Sunset className="w-4 h-4 text-[#5EC9CC]" />
                <span className="text-xs text-zinc-400">{weather.sunset}</span>
              </div>
            </div>

            {/* Hourly */}
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Hourly</div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {weather.hourly.map((h, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg bg-zinc-800/20 shrink-0 min-w-[50px]">
                    <span className="text-[10px] text-zinc-600">{h.time}</span>
                    {getWeatherIcon(h.conditionCode, 'w-5 h-5')}
                    <span className="text-xs text-white font-medium">{t(h.temp_c, h.temp_f)}</span>
                    {h.rain_chance > 0 && (
                      <span className="text-[9px] text-blue-400">{h.rain_chance}%</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : weather && tab === 'forecast' ? (
          <div className="p-4 space-y-2">
            {weather.forecast.map((day, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/20 border border-zinc-800/30">
                <div className="w-16 text-sm font-medium text-zinc-300">{dayName(day.date)}</div>
                {getWeatherIcon(day.conditionCode, 'w-6 h-6')}
                <div className="flex-1 text-xs text-zinc-500 truncate">{day.condition}</div>
                {day.rain_chance > 0 && (
                  <div className="flex items-center gap-0.5 text-blue-400 text-[10px]">
                    <Droplets className="w-3 h-3" /> {day.rain_chance}%
                  </div>
                )}
                <div className="text-sm font-medium text-white w-12 text-right">
                  {t(day.maxtemp_c, day.maxtemp_f)}
                </div>
                <div className="text-sm text-zinc-600 w-12 text-right">
                  {t(day.mintemp_c, day.mintemp_f)}
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'clocks' ? (
          <div className="p-4 grid grid-cols-2 gap-2">
            {WORLD_CLOCKS.map(wc => {
              const now = new Date()
              let timeStr = ''
              try { timeStr = now.toLocaleTimeString('en', { timeZone: wc.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }) } catch (_e) { timeStr = '--:--' }
              let dateStr = ''
              try { dateStr = now.toLocaleDateString('en', { timeZone: wc.timezone, weekday: 'short', month: 'short', day: 'numeric' }) } catch (_e) {}
              return (
                <div key={wc.timezone} className="p-3 rounded-xl bg-zinc-800/20 border border-zinc-800/30">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Globe2 className="w-3 h-3 text-[#5EC9CC]" />
                    <span className="text-xs text-zinc-400">{wc.city}</span>
                    <span className="text-[10px] text-zinc-700 ml-auto">{wc.label}</span>
                  </div>
                  <div className="text-lg font-bold text-white tabular-nums">{timeStr}</div>
                  <div className="text-[10px] text-zinc-600">{dateStr}</div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
