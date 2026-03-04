module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=40.7475&longitude=-89.5746&current=temperature_2m,weathercode&temperature_unit=fahrenheit&forecast_days=1");
    const d = await r.json();
    const temp = Math.round(d.current.temperature_2m);
    const wm = {0:{label:"Clear Sky",icon:"☀️"},1:{label:"Mainly Clear",icon:"🌤️"},2:{label:"Partly Cloudy",icon:"⛅"},3:{label:"Overcast",icon:"☁️"},45:{label:"Foggy",icon:"🌫️"},51:{label:"Drizzle",icon:"🌦️"},61:{label:"Rain",icon:"🌧️"},71:{label:"Snow",icon:"🌨️"},80:{label:"Showers",icon:"🌦️"},95:{label:"Thunderstorm",icon:"⛈️"}};
    const wx = wm[d.current.weathercode] || {label:"Variable",icon:"🌡️"};
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=300");
    res.status(200).json({ temp, label: wx.label, icon: wx.icon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
