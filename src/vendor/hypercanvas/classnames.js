import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Only Vendored chrome utilities participate in Core's conflict groups. Foreign classes
 * (including an unprefixed prototype utility) are preserved, not reinterpreted. */
export function cn(...inputs) {
  const classes = clsx(inputs).split(/\s+/).filter(Boolean)
  const core = classes.filter(name => name.startsWith('ds-')).map(name => name.slice(3))
  const foreign = classes.filter(name => !name.startsWith('ds-'))
  const merged = twMerge(core.join(' ')).split(/\s+/).filter(Boolean).map(name => `ds-${name}`)
  return [...foreign, ...merged].join(' ')
}
