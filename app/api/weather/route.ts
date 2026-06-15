export async function GET() {
    const apiKey = process.env.WEATHER_API_KEY
    const city = 'Ningbo'
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=zh_cn`
  
    try {
      const res = await fetch(url)
      const data = await res.json()
  
      if (data.cod !== 200) {
        return Response.json({ error: 'weather fetch failed' }, { status: 500 })
      }
  
      return Response.json({
        temp: Math.round(data.main.temp),
        feels_like: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        description: data.weather[0].description,
        icon: data.weather[0].icon,
        wind: data.wind.speed,
      })
    } catch {
      return Response.json({ error: 'network error' }, { status: 500 })
    }
  }