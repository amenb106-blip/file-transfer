export function minutesLeft(expiresAt: string, now: number) {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

export function watchExpiration(expiresAt: string, onTick: (now: number) => void) {
  const deadline = Date.parse(expiresAt)
  let timer: ReturnType<typeof setTimeout> | undefined

  function update() {
    clearTimeout(timer)
    const now = Date.now()
    onTick(now)
    if (now < deadline) timer = setTimeout(update, Math.min(1000, deadline - now))
  }

  // Background tabs can suspend timers. Catch up as soon as the page returns.
  window.addEventListener('focus', update)
  document.addEventListener('visibilitychange', update)
  update()
  return () => {
    clearTimeout(timer)
    window.removeEventListener('focus', update)
    document.removeEventListener('visibilitychange', update)
  }
}
