/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        card: '#18181b',
        'card-foreground': '#fafafa',
        border: '#27272a',
        input: '#27272a',
        primary: '#3b82f6',
        'primary-foreground': '#fafafa',
        secondary: '#27272a',
        'secondary-foreground': '#fafafa',
        muted: '#27272a',
        'muted-foreground': '#a1a1aa',
        accent: '#27272a',
        'accent-foreground': '#fafafa',
      },
    },
  },
  plugins: [],
};
