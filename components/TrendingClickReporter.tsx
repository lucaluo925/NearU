'use client'

/**
 * Thin client wrapper around trending cards.
 * Fires a pet:react event when the user clicks into a trending item,
 * so the pet can react with "this one's popular…" context dialogue.
 * Navigation still proceeds normally — this only adds a side-effect.
 */
export default function TrendingClickReporter({ children }: { children: React.ReactNode }) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent('pet:react', {
        detail: { type: 'bounce', context: 'trending' },
      }),
    )
  }
  return <div onClick={handleClick}>{children}</div>
}
