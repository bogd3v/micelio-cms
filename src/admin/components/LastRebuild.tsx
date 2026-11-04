import { Box, Typography } from '@strapi/design-system'
import { useFetchClient } from '@strapi/strapi/admin'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'

interface Reason {
  code: 'settings-unreadable' | 'settings-invalid' | 'theme-refused' | 'theme-not-ready' | 'unknown'
  rule: string | null
  detail: 'theme-id' | 'not-listed' | 'not-public' | null
  httpStatus: number | null
  seconds: number | null
}

interface LastRebuildModel {
  configured: boolean
  unreadable: boolean
  lastRebuild: {
    status: 'succeeded' | 'failed'
    finishedAt: string | null
    reasons: Reason[]
    previousSiteKept: boolean
  } | null
}

const THEME_RULES = [
  'pin',
  'unknown',
  'code',
  'off',
  'tier',
  'limit',
  'registry',
  'install',
  'integrity',
]

/**
 * How the static builder's last run ended, shown under the theme field (`GET /theme-picker/last-rebuild`).
 * A failed run says why and whether the previous site is kept. The sentence is built here from codes
 * the CMS parsed; nothing the builder printed is shown as written.
 * Nothing is shown when the instance records no builder runs, or when the route is not available.
 */
export default function LastRebuild() {
  const { formatMessage, formatDate } = useIntl()
  const { get } = useFetchClient()
  const [model, setModel] = useState<LastRebuildModel | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await get<{ data: LastRebuildModel }>('/theme-picker/last-rebuild')
        if (!cancelled) setModel(response.data.data)
      } catch {
        // The route answers only the Super Admin; for anyone else, or on an error, there is nothing to show.
        if (!cancelled) setModel(null)
      }
    }
    void load()
    // A rebuild can end while the page is open: read again when the tab is back in front
    const reload = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', reload)
    window.addEventListener('focus', reload)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', reload)
      window.removeEventListener('focus', reload)
    }
  }, [get])

  if (!model?.configured) return null
  const run = model.lastRebuild
  if (model.unreadable) {
    return (
      <Typography variant="pi" textColor="danger600" data-testid="last-rebuild">
        {formatMessage({
          id: 'micelio.lastRebuild.unreadable',
          defaultMessage:
            'Last rebuild: the builder’s record cannot be read; check the build-status volume.',
        })}
      </Typography>
    )
  }
  if (!run) {
    return (
      <Typography variant="pi" textColor="neutral600" data-testid="last-rebuild">
        {formatMessage({
          id: 'micelio.lastRebuild.none',
          defaultMessage: 'Last rebuild: the builder has not run yet.',
        })}
      </Typography>
    )
  }
  const reasonText = (reason: Reason): string => {
    switch (reason.code) {
      case 'settings-unreadable':
        return reason.httpStatus === null
          ? formatMessage({
              id: 'micelio.lastRebuild.reason.settingsUnreadable',
              defaultMessage:
                'The site settings could not be read from Strapi, so the theme they name is unknown.',
            })
          : formatMessage(
              {
                id: 'micelio.lastRebuild.reason.settingsUnreadableHttp',
                defaultMessage:
                  'The site settings could not be read from Strapi (HTTP {status}), so the theme they name is unknown.',
              },
              { status: reason.httpStatus }
            )
      case 'settings-invalid':
        return formatMessage({
          id: 'micelio.lastRebuild.reason.settingsInvalid',
          defaultMessage:
            'Strapi did not answer with valid site settings, so the theme they name is unknown.',
        })
      case 'theme-refused': {
        const rule = THEME_RULES.includes(reason.rule ?? '') ? reason.rule : 'unknown'
        const key = reason.detail === null ? rule : `${rule}.${reason.detail}`
        const why = formatMessage({
          id: `micelio.lastRebuild.rule.${key}`,
          defaultMessage: 'it was refused',
        })
        return formatMessage(
          {
            id: 'micelio.lastRebuild.reason.refused',
            defaultMessage:
              'The theme the site settings name was not used: {why}; see the builder’s log.',
          },
          { why }
        )
      }
      case 'theme-not-ready':
        return formatMessage(
          {
            id: 'micelio.lastRebuild.reason.notReady',
            defaultMessage: 'The theme the site settings name was not ready after {seconds} s.',
          },
          { seconds: reason.seconds ?? 0 }
        )
      default:
        return formatMessage({
          id: 'micelio.lastRebuild.reason.unknown',
          defaultMessage:
            'The builder gave a reason this page does not show; see the builder’s log.',
        })
    }
  }
  const when = run.finishedAt
    ? formatDate(new Date(run.finishedAt), { dateStyle: 'medium', timeStyle: 'short' })
    : ''
  if (run.status === 'succeeded') {
    return (
      <Typography variant="pi" textColor="neutral600" data-testid="last-rebuild">
        {formatMessage(
          { id: 'micelio.lastRebuild.succeeded', defaultMessage: 'Last rebuild: succeeded {when}' },
          { when }
        )}
      </Typography>
    )
  }
  return (
    <Box data-testid="last-rebuild">
      <Typography variant="pi" textColor="danger600" fontWeight="bold" display="block">
        {formatMessage(
          { id: 'micelio.lastRebuild.failed', defaultMessage: 'Last rebuild: failed {when}' },
          { when }
        )}
      </Typography>
      {run.reasons.length > 0 ? (
        run.reasons.map((reason) => {
          const text = reasonText(reason)
          return (
            <Typography key={text} variant="pi" textColor="danger600" display="block">
              {text}
            </Typography>
          )
        })
      ) : (
        <Typography variant="pi" textColor="danger600" display="block">
          {formatMessage({
            id: 'micelio.lastRebuild.noReason',
            defaultMessage: 'The builder gave no reason; its log has the details.',
          })}
        </Typography>
      )}
      <Typography variant="pi" textColor="neutral600" display="block">
        {run.previousSiteKept
          ? formatMessage({
              id: 'micelio.lastRebuild.kept',
              defaultMessage: 'The previous site is kept in the output volume.',
            })
          : formatMessage({
              id: 'micelio.lastRebuild.notKept',
              defaultMessage:
                'There is no previous site to keep, or the builder did not say; check the site.',
            })}
      </Typography>
    </Box>
  )
}
