import { useId, useState } from 'react'
import { LoaderCircle, Lock } from 'lucide-react'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { hasRemoteProviderRuntime } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'

type ProductiveConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
  overlayClassName?: string
  contentClassName?: string
}

type ConnectState = 'idle' | 'connecting' | 'error'

// Why: Productive uses a single API token + organization id (no multi-site), so
// this mirrors the Jira connect dialog with two fields instead of three and a
// single-credential connect flow routed through the Productive store slice.
export function ProductiveConnectDialog({
  open,
  onOpenChange,
  onConnected,
  overlayClassName,
  contentClassName
}: ProductiveConnectDialogProps): React.JSX.Element {
  const connectProductive = useAppStore((s) => s.connectProductive)
  const settings = useAppStore((s) => s.settings)
  const mountedRef = useMountedRef()
  const organizationId = useId()
  const tokenId = useId()
  const personIdInputId = useId()
  const errorId = useId()

  const [organizationIdDraft, setOrganizationIdDraft] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [personIdDraft, setPersonIdDraft] = useState('')
  const [connectState, setConnectState] = useState<ConnectState>('idle')
  const [connectError, setConnectError] = useState<string | null>(null)

  const canSubmit =
    Boolean(organizationIdDraft.trim()) && Boolean(apiToken.trim()) && connectState !== 'connecting'
  const credentialStorageCopy = hasRemoteProviderRuntime(settings)
    ? 'Your token is sent to the selected remote runtime and stored there with runtime-supported encryption.'
    : 'Your token is stored locally and encrypted when local runtime storage supports it.'

  const clearErrorOnEdit = (): void => {
    if (connectState === 'error') {
      setConnectState('idle')
      setConnectError(null)
    }
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (connectState !== 'connecting') {
      onOpenChange(nextOpen)
    }
  }

  const handleConnect = async (): Promise<void> => {
    const trimmedOrg = organizationIdDraft.trim()
    const trimmedToken = apiToken.trim()
    if (!trimmedOrg || !trimmedToken || connectState === 'connecting') {
      return
    }
    setConnectState('connecting')
    setConnectError(null)
    try {
      const trimmedPersonId = personIdDraft.trim()
      const result = await connectProductive({
        apiToken: trimmedToken,
        organizationId: trimmedOrg,
        ...(trimmedPersonId ? { personId: trimmedPersonId } : {})
      })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setOrganizationIdDraft('')
        setApiToken('')
        setPersonIdDraft('')
        setConnectState('idle')
        onOpenChange(false)
        onConnected?.()
        return
      }
      setConnectState('error')
      setConnectError(result.error)
    } catch (error) {
      if (mountedRef.current) {
        setConnectState('error')
        setConnectError(error instanceof Error ? error.message : 'Connection failed')
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName={overlayClassName}
        className={cn('sm:max-w-md', contentClassName)}
      >
        <DialogHeader className="gap-3">
          <DialogTitle className="leading-tight">
            {translate('auto.components.productive.connect.dialog.title', 'Connect Productive')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.productive.connect.dialog.desc',
              'Use a Productive API token and organization id to browse tasks.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleConnect()
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor={organizationId} className="text-xs">
                {translate('auto.components.productive.connect.dialog.orglabel', 'Organization id')}
              </Label>
              <Input
                id={organizationId}
                autoFocus
                placeholder={translate(
                  'auto.components.productive.connect.dialog.orgph',
                  'e.g. 12345'
                )}
                value={organizationIdDraft}
                onChange={(event) => {
                  setOrganizationIdDraft(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={tokenId} className="text-xs">
                {translate('auto.components.productive.connect.dialog.tokenlabel', 'API token')}
              </Label>
              <Input
                id={tokenId}
                type="password"
                placeholder={translate(
                  'auto.components.productive.connect.dialog.tokenph',
                  'Productive API token'
                )}
                value={apiToken}
                onChange={(event) => {
                  setApiToken(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
                aria-invalid={connectState === 'error'}
                aria-describedby={connectState === 'error' ? errorId : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={personIdInputId} className="text-xs">
                {translate(
                  'auto.components.productive.connect.dialog.personlabel',
                  'Person id (optional)'
                )}
              </Label>
              <Input
                id={personIdInputId}
                placeholder={translate(
                  'auto.components.productive.connect.dialog.personph',
                  'e.g. 96137'
                )}
                value={personIdDraft}
                onChange={(event) => {
                  setPersonIdDraft(event.target.value)
                  clearErrorOnEdit()
                }}
                disabled={connectState === 'connecting'}
              />
              <p className="text-[11px] text-muted-foreground/70">
                {translate(
                  'auto.components.productive.connect.dialog.personhelp',
                  'Your Productive person id. Optional, but enables the "assigned to me" task filters and shows your name. Find it in your Productive profile URL.'
                )}
              </p>
            </div>
            {connectState === 'error' && connectError ? (
              <p id={errorId} className="text-xs text-destructive">
                {connectError}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.productive.connect.dialog.tokenhelp',
                'Create a token in'
              )}{' '}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() =>
                  window.api.shell.openUrl('https://app.productive.io/settings/api-integrations')
                }
              >
                {translate(
                  'auto.components.productive.connect.dialog.tokensettings',
                  'Productive API settings'
                )}
              </button>
              .
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Lock className="size-3 shrink-0" />
              {credentialStorageCopy}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={connectState === 'connecting'}
            >
              {translate('auto.components.productive.connect.dialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {connectState === 'connecting' ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  {translate('auto.components.productive.connect.dialog.verifying', 'Verifying…')}
                </>
              ) : (
                translate('auto.components.productive.connect.dialog.connect', 'Connect')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
