/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
  	extend: {
      fontSize: { xs: ["0.8125rem", { lineHeight: "1.45" }] },
  		fontFamily: {
  			sans: [
  				'IBM Plex Sans',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'sans-serif'
  			],
  			mono: [
  				'IBM Plex Mono',
  				'SF Mono',
  				'ui-monospace',
  				'monospace'
  			]
  		},
  		colors: {
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
  			primary: {
  				DEFAULT: '#9ac4fb',
  				light: '#7AAEE0',
  				dark: '#457EBA'
  			},
  			secondary: {
  				DEFAULT: '#f2c278',
  				light: '#EAB655',
  				dark: '#BF8520'
  			},
  			success: {
  				DEFAULT: '#9be7be',
  				light: '#5AC294',
  				dark: '#319567'
  			},
  			warning: {
  				DEFAULT: '#f2c278',
  				light: '#EAB655',
  				dark: '#BF8520'
  			},
  			danger: {
  				DEFAULT: '#ffab9e',
  				light: '#EC6D71',
  				dark: '#C3363B'
  			},
  			info: {
  				DEFAULT: '#9ac4fb',
  				light: '#7AAEE0',
  				dark: '#457EBA'
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
  			xl: '8px',
  			'2xl': '12px'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [],
};
