/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontSize: { xs: ["0.8125rem", { lineHeight: "1.45" }] },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif'
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'monospace'
        ]
      },
      colors: {
        ink: '#17181b',
        amber: {
          DEFAULT: '#f2b84b',
          hot: '#ffd377',
        },
        signal: '#55e0a3',
        cargo: '#ff6a5c',
        railblue: '#93b8ff',
        ground: '#111816',
        panel: '#1a231f',
        rule: '#344039',
        text: {
          DEFAULT: '#f1f5ef',
          muted: '#acb9b0',
          subtle: '#9aaa9f'
        },
        state: {
          clear: '#9be7be',
          caution: '#f2c278',
          danger: '#ffab9e',
          occupied: '#9ac4fb'
        },
        surface: {
          '1': '#1a231f',
          '2': '#233128',
          '3': '#344039'
        }
      },
      boxShadow: {
        soft: '0 2px 4px rgba(0,0,0,0.2)'
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem'
      }
    }
  },
  plugins: []
}
