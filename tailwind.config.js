/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Chakra Petch', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        bg: '#08090D',
        surface: '#0F1117',
        surface2: '#161920',
        border: '#1E2330',
        accent: '#00E5A0',
        'accent-dim': '#00B87D',
        danger: '#FF4560',
        'danger-dim': '#CC3750',
        warning: '#FFB800',
        muted: '#64748B',
        textprimary: '#E2E8F0',
        textsecondary: '#94A3B8',
      },
      backgroundImage: {
        'grid-pattern': "linear-gradient(rgba(30,35,48,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(30,35,48,0.3) 1px, transparent 1px)",
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
    },
  },
  plugins: [],
}
