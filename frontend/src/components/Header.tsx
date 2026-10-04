import { useState } from 'react'
import { applyTheme, currentTheme } from '../theme'
import type { Theme } from '../theme'
import { LogoMark, MoonIcon, SunIcon } from './icons'

function Header() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  function toggleTheme() {
    applyTheme(next)
    setTheme(next)
  }

  return (
    <header className="site-header">
      <a href="/" className="brand">
        <LogoMark />
        File Transfer
      </a>
      <button type="button" className="theme-toggle" onClick={toggleTheme}>
        {next === 'dark' ? <MoonIcon size={18} /> : <SunIcon size={18} />}
        {next === 'dark' ? 'Dark mode' : 'Light mode'}
      </button>
    </header>
  )
}

export default Header
