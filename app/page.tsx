'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import EpiphyllumEffect from './components/EpiphyllumEffect'
import MountainEffect from './components/MountainEffect'

type Weather = {
  temp: number
  humidity: number
  description: string
  icon: string
}

type HomepageTheme = 'epiphyllum' | 'mountain'

export default function HomePage() {
  const router = useRouter()
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  const [mounted, setMounted] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [weather, setWeather] = useState<Weather | null>(null)
  const [homepageTheme, setHomepageTheme] = useState<HomepageTheme>('epiphyllum')
  const [triggerScatter, setTriggerScatter] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem('homepage-theme') as HomepageTheme | null
    if (saved === 'epiphyllum' || saved === 'mountain') setHomepageTheme(saved)
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      setDate(now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))
    }
    tick()
    const timer = setInterval(tick, 1000)
    fetch('/api/weather')
      .then(r => r.json())
      .then(d => { if (!d.error) setWeather(d) })
      .catch(() => {})
    return () => clearInterval(timer)
  }, [])

  const handleEnterChat = () => {
    setTransitioning(true)
    setTriggerScatter(true)
  }

  const handleScatterComplete = () => {
    router.push('/chat')
  }

  const toggleTheme = () => {
    const next: HomepageTheme = homepageTheme === 'epiphyllum' ? 'mountain' : 'epiphyllum'
    setHomepageTheme(next)
    setTriggerScatter(false)
    localStorage.setItem('homepage-theme', next)
  }

  const isMountain = homepageTheme === 'mountain'
  const textColor = isMountain ? 'rgba(26,43,52,0.85)' : 'rgba(255,255,255,0.95)'
  const textColorSub = isMountain ? 'rgba(67,123,121,0.75)' : 'rgba(255,255,255,0.75)'
  const textColorWeather = isMountain ? 'rgba(26,43,52,0.90)' : 'rgba(255,255,255,0.92)'
  const textColorWeatherSub = isMountain ? 'rgba(67,123,121,0.65)' : 'rgba(255,255,255,0.7)'

  if (!mounted) return null

  return (
    <div className="fixed inset-0 overflow-hidden">
      {homepageTheme === 'epiphyllum' ? (
        <EpiphyllumEffect
          onAnimationComplete={() => {}}
          onScatterComplete={handleScatterComplete}
          triggerScatter={triggerScatter}
        />
      ) : (
        <MountainEffect
          onScatterComplete={handleScatterComplete}
          triggerScatter={triggerScatter}
        />
      )}

      <div className="absolute inset-0" style={{ background: isMountain ? 'rgba(242,240,228,0.0)' : 'rgba(20,15,8,0.08)' }} />

      {/* 主题切换按钮 */}
      <button
        onClick={toggleTheme}
        style={{
          position: 'fixed',
          top: '28px',
          right: '28px',
          zIndex: 20,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: isMountain ? 'rgba(67,123,121,0.55)' : 'rgba(255,255,255,0.4)',
          fontSize: '11px',
          letterSpacing: '0.25em',
          fontFamily: "'Noto Serif SC', serif",
          fontWeight: 300,
          transition: 'opacity 0.2s ease',
          padding: '4px 0',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.7' }}
        title={isMountain ? '切换至昙花' : '切换至山水'}
      >
        {isMountain ? '◈ 昙花' : '◈ 山水'}
      </button>

      {/* 时间天气 */}
      <div className="absolute top-10 left-12 z-10" style={{
        transform: transitioning ? 'translateY(-120px)' : 'translateY(0)',
        opacity: transitioning ? 0 : 1,
        transition: 'transform 0.6s ease-in, opacity 0.4s ease-in',
      }}>
        <div
          className="text-6xl font-light tracking-wider"
          style={{ color: textColor, textShadow: isMountain ? 'none' : '0 2px 16px rgba(0,0,0,0.2)' }}
        >
          {time}
        </div>
        <div
          className="text-sm mt-1.5"
          style={{ color: textColorSub }}
        >
          {date}
        </div>
        {weather && (
          <div className="mt-8 space-y-1.5">
            <div
              className="text-4xl font-light"
              style={{ color: textColorWeather }}
            >
              {weather.temp}°C
            </div>
            <div className="text-sm" style={{ color: textColorWeatherSub }}>
              {weather.description}
            </div>
            <div className="text-sm" style={{ color: isMountain ? 'rgba(67,123,121,0.55)' : 'rgba(255,255,255,0.6)' }}>
              湿度 {weather.humidity}%
            </div>
          </div>
        )}
      </div>

      {/* 入口文字 */}
      <div
        className="absolute z-10"
        style={{
          bottom: '40px', right: '48px',
          transform: transitioning ? 'translateY(120px)' : 'translateY(0)',
          opacity: transitioning ? 0 : 1,
          transition: 'transform 0.6s ease-in, opacity 0.4s ease-in',
        }}
      >
        <div
          onClick={handleEnterChat}
          className="cursor-pointer"
          style={{ transition: 'opacity 0.2s ease' }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.6' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          {isMountain ? (
            <span style={{
              fontFamily: "'Noto Serif SC', serif",
              fontWeight: 300,
              fontSize: '18px',
              color: 'rgba(67,123,121,0.75)',
              letterSpacing: '0.35em',
              writingMode: 'vertical-rl',
            }}>借山一隅</span>
          ) : (
            <span style={{
              fontFamily: 'var(--font-pinyon-script), Georgia, serif',
              fontStyle: 'italic',
              fontSize: '28px',
              color: 'rgba(255,255,255,0.85)',
              letterSpacing: '0.08em',
            }}>Enter the bloom</span>
          )}
        </div>
      </div>
    </div>
  )
}
