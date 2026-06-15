'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Weather = {
  temp: number
  humidity: number
  description: string
  icon: string
}

export default function HomePage() {
  const router = useRouter()
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  const [mounted, setMounted] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [weather, setWeather] = useState<Weather | null>(null)

  useEffect(() => {
    setMounted(true)
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
    setTimeout(() => router.push('/chat'), 500)
  }

  if (!mounted) return null

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        opacity: transitioning ? 0 : 1,
        transition: 'opacity 0.5s ease',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/bg.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0" style={{ background: 'rgba(20,15,8,0.08)' }} />

      <div className="absolute top-10 left-12 z-10">
        <div
          className="text-6xl font-light tracking-wider"
          style={{ color: 'rgba(255,255,255,0.95)', textShadow: '0 2px 16px rgba(0,0,0,0.2)' }}
        >
          {time}
        </div>
        <div
          className="text-sm mt-1.5"
          style={{ color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 8px rgba(0,0,0,0.15)' }}
        >
          {date}
        </div>

        {weather && (
          <div className="mt-8 space-y-1.5">
            <div
              className="text-4xl font-light"
              style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 2px 12px rgba(0,0,0,0.18)' }}
            >
              {weather.temp}°C
            </div>
            <div className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {weather.description}
            </div>
            <div className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              湿度 {weather.humidity}%
            </div>
          </div>
        )}
      </div>

      <div
        className="absolute z-10"
        style={{ bottom: '40px', right: '48px' }}
      >
        <div
          onClick={handleEnterChat}
          className="cursor-pointer flex items-center gap-3 px-5 py-3 rounded-2xl"
          style={{
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.25)',
            transition: 'transform 0.2s ease, background 0.2s ease',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.28)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.18)'
          }}
        >
          <span style={{ fontSize: '18px' }}>✦</span>
          <span className="text-sm font-light" style={{ color: 'rgba(255,255,255,0.9)' }}>开始对话</span>
        </div>
      </div>
    </div>
  )
}