/** `FEDIVERSE_ACTOR_*` variables replaced by the site settings' `fediverse` component (#303). */
const DEPRECATED_ACTOR_VARIABLES = [
  ['FEDIVERSE_ACTOR_USERNAME', 'Username'],
  ['FEDIVERSE_ACTOR_NAME', 'Display name'],
  ['FEDIVERSE_ACTOR_SUMMARY', 'Summary'],
  ['FEDIVERSE_ACTOR_SOURCE_URL', 'Source URL'],
] as const

/**
 * Writes one warning per deprecated `FEDIVERSE_ACTOR_*` variable that is set, naming the site
 * setting that replaces it. The variable keeps working as a fallback until a later `0.y` removes it.
 *
 * @returns The names of the variables it warned about.
 */
export function warnDeprecatedActorVariables(
  log: { warn(message: string): void },
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const warned: string[] = []
  for (const [name, field] of DEPRECATED_ACTOR_VARIABLES) {
    if (!env[name]?.trim()) continue
    log.warn(
      `[fediverse] ${name} is deprecated: set "${field}" under Site settings > Fediverse profile instead. The variable still works as a fallback`
    )
    warned.push(name)
  }
  return warned
}
