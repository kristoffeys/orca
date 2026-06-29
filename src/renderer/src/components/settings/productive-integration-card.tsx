import { useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, Unlink } from 'lucide-react'
import { ProductiveConnectDialog } from '@/components/productive-connect-dialog'
import { ProductiveIcon } from '@/components/icons/ProductiveIcon'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  getProviderRuntimeContextKey,
  hasRemoteProviderRuntime
} from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useIntegrationSubordinateRowClass } from './integration-card-presentation'
import { getProviderAccountScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { translate } from '@/i18n/i18n'

type VerificationResult = { state: 'ok' | 'error'; error?: string }

// Why: Productive is a single-credential provider (one API token -> one
// organization), so this card shows a single connected viewer row instead of
// Jira's per-site list, but otherwise mirrors the task-tracker card shell.
export function ProductiveIntegrationCard(): React.JSX.Element {
  const productiveStatus = useAppStore((s) => s.productiveStatus)
  const productiveStatusChecked = useAppStore((s) => s.productiveStatusChecked)
  const productiveStatusContextKey = useAppStore((s) => s.productiveStatusContextKey)
  const checkProductiveConnection = useAppStore((s) => s.checkProductiveConnection)
  const disconnectProductive = useAppStore((s) => s.disconnectProductive)
  const testProductiveConnection = useAppStore((s) => s.testProductiveConnection)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<VerificationResult | null>(null)

  const contextMatches = productiveStatusContextKey === getProviderRuntimeContextKey(settings)
  const checking = !contextMatches || !productiveStatusChecked
  const connected = contextMatches && productiveStatus.connected
  const viewer = productiveStatus.viewer
  const accountScope = getProviderAccountScope(settings)
  const subordinateRowClass = useIntegrationSubordinateRowClass('flex items-center gap-3')
  const accountScopeRowClass = useIntegrationSubordinateRowClass('text-xs')
  const credentialCopy = hasRemoteProviderRuntime(settings)
    ? translate(
        'auto.components.settings.productive.integration.card.cred_remote',
        'Connect your Productive organization with an API token and organization id. Credentials are sent to the selected remote runtime and stored there with runtime-supported encryption.'
      )
    : translate(
        'auto.components.settings.productive.integration.card.cred_local',
        'Connect your Productive organization with an API token and organization id. Credentials are stored locally and encrypted when local runtime storage supports it.'
      )

  const handleDisconnect = async (): Promise<void> => {
    await disconnectProductive()
    if (mountedRef.current) {
      setTestResult(null)
    }
  }

  // Why: explicit user-triggered verification. This is the only settings path
  // that decrypts the stored Productive token, avoiding surprise keychain prompts.
  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const result = await testProductiveConnection()
    if (!mountedRef.current) {
      return
    }
    setTestResult(result.ok ? { state: 'ok' } : { state: 'error', error: result.error })
    setTesting(false)
  }

  return (
    <IntegrationCardShell
      icon={<ProductiveIcon className="size-5" />}
      name="Productive"
      description={
        connected
          ? translate(
              'auto.components.settings.productive.integration.card.connected_desc',
              'Connected as {{value0}}',
              { value0: viewer?.name ?? 'Productive' }
            )
          : checking
            ? translate(
                'auto.components.settings.productive.integration.card.checking_desc',
                'Checking Productive access before showing setup actions.'
              )
            : translate(
                'auto.components.settings.productive.integration.card.disconnected_desc',
                'Browse, create, and start work from Productive tasks.'
              )
      }
      checking={checking}
      statusTone={connected ? 'connected' : 'attention'}
      statusLabel={connected ? 'Connected' : 'Not connected'}
      actions={
        !checking ? (
          <Button
            variant={connected ? 'outline' : 'default'}
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            {connected
              ? translate(
                  'auto.components.settings.productive.integration.card.reconnect',
                  'Reconnect'
                )
              : translate(
                  'auto.components.settings.productive.integration.card.connect',
                  'Connect Productive'
                )}
          </Button>
        ) : null
      }
    >
      <IntegrationCardDetails>
        <ProviderHostScopeControl
          labelPrefix={translate(
            'auto.components.settings.task.tracker.integration.cards.account_scope_prefix',
            'Account scope'
          )}
          scope={accountScope}
          className={accountScopeRowClass}
        />
        {connected ? (
          <div className="space-y-2">
            <div className={subordinateRowClass}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {viewer?.name ??
                    translate(
                      'auto.components.settings.productive.integration.card.organization',
                      'Productive organization'
                    )}
                </p>
                {viewer?.email ? (
                  <p className="truncate text-xs text-muted-foreground">{viewer.email}</p>
                ) : null}
              </div>
              {testResult?.state === 'ok' ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-status-success">
                  <CheckCircle2 className="size-3.5" />
                  {translate(
                    'auto.components.settings.task.tracker.integration.cards.a2c0015fb8',
                    'Verified'
                  )}
                </span>
              ) : null}
              {testResult?.state === 'error' ? (
                <span className="flex min-w-0 max-w-[220px] shrink items-center gap-1 truncate text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span className="truncate">{testResult.error}</span>
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTest()}
                disabled={testing}
              >
                {testing ? (
                  <>
                    <LoaderCircle className="size-3.5 mr-1.5 animate-spin" />
                    {translate(
                      'auto.components.settings.task.tracker.integration.cards.3e7c10d286',
                      'Testing...'
                    )}
                  </>
                ) : (
                  translate(
                    'auto.components.settings.task.tracker.integration.cards.c24e56c532',
                    'Test'
                  )
                )}
              </Button>
              <button
                onClick={() => void handleDisconnect()}
                aria-label={translate(
                  'auto.components.settings.productive.integration.card.disconnect_aria',
                  'Disconnect Productive'
                )}
                className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-destructive"
              >
                <Unlink className="size-3.5" />
              </button>
            </div>
          </div>
        ) : !checking ? (
          <>
            <p className="text-xs text-muted-foreground">{credentialCopy}</p>
            <Button variant="ghost" size="sm" onClick={() => void checkProductiveConnection()}>
              {translate(
                'auto.components.settings.task.tracker.integration.cards.c90f2ef419',
                'Re-check'
              )}
            </Button>
          </>
        ) : null}
      </IntegrationCardDetails>

      <ProductiveConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConnected={() => setTestResult(null)}
        overlayClassName="z-[110]"
        contentClassName="z-[120]"
      />
    </IntegrationCardShell>
  )
}
