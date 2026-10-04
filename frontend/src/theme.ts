export type Theme = 'light' | 'dark'

// index.html sets data-theme before React loads, so the page never flashes the wrong theme.
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // Storage can be blocked (for example in private windows); the theme still applies for this visit.
  }
}
