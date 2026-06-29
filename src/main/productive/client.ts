/* eslint-disable max-lines -- Why: Productive credential storage and authenticated
request plumbing share one boundary so encrypted token lifecycle and viewer
caching cannot drift between task operations. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net, safeStorage, session } from 'electron'
import {
  CredentialDecryptionError,
  readStoredCredentialToken
} from '../integration-credential-file'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan } from '../observability/tracer'
import type { ProductiveConnectionStatus, ProductiveViewer } from '../../shared/productive-types'

// Why: Productive's JSON:API auth is token + organization header pair, so a
// non-browser User-Agent keeps request shaping consistent with how Orca
// identifies itself across integrations.
const PRODUCTIVE_API_BASE = 'https://api.productive.io/api/v2'
const PRODUCTIVE_API_USER_AGENT = 'Orca'

const MAX_CONCURRENT = 4
let running = 0
const queue: (() => void)[] = []

export function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1
    return Promise.resolve()
  }
  return new Promise((resolve) =>
    queue.push(() => {
      running += 1
      resolve()
    })
  )
}

export function release(): void {
  running -= 1
  const next = queue.shift()
  if (next) {
    next()
  }
}

export type ProductiveClient = {
  token: string
  organizationId: string
  viewerId: string
}

type ProductiveCredentialFile = {
  version: 1
  organizationId: string
  viewer: ProductiveViewer | null
  hasToken: boolean
}

export class ProductiveApiError extends Error {
  status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

let cachedCredentialFile: ProductiveCredentialFile | null = null
let credentialFileLoaded = false
let cachedToken: string | null = null
// Why: a decrypt failure is recorded once so getStatus can explain a failing
// read without re-touching the keychain on every status poll.
let credentialError: string | null = null

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getCredentialFilePath(): string {
  return join(getOrcaDir(), 'productive-credentials.json')
}

function getTokenPath(): string {
  return join(getOrcaDir(), 'productive-token.enc')
}

function ensureOrcaDir(): void {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function normalizeViewer(input: unknown): ProductiveViewer | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.name !== 'string') {
    return null
  }
  return {
    id: record.id,
    name: record.name,
    email: typeof record.email === 'string' ? record.email : null,
    ...(typeof record.avatarUrl === 'string' ? { avatarUrl: record.avatarUrl } : {})
  }
}

function readCredentialFileFromDisk(): ProductiveCredentialFile | null {
  const path = getCredentialFilePath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed = JSON.parse(
      readFileSync(path, { encoding: 'utf-8' })
    ) as Partial<ProductiveCredentialFile>
    if (typeof parsed.organizationId !== 'string') {
      return null
    }
    return {
      version: 1,
      organizationId: parsed.organizationId,
      viewer: normalizeViewer(parsed.viewer),
      hasToken: parsed.hasToken === true
    }
  } catch {
    return null
  }
}

function getCredentialFile(): ProductiveCredentialFile | null {
  if (!credentialFileLoaded) {
    cachedCredentialFile = readCredentialFileFromDisk()
    credentialFileLoaded = true
  }
  return cachedCredentialFile
}

function writeCredentialFile(file: ProductiveCredentialFile): void {
  ensureOrcaDir()
  cachedCredentialFile = file
  credentialFileLoaded = true
  writeFileSync(getCredentialFilePath(), JSON.stringify(file, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function clearCredentialFile(): void {
  cachedCredentialFile = null
  credentialFileLoaded = true
  try {
    unlinkSync(getCredentialFilePath())
  } catch {
    // File may not exist — safe to ignore.
  }
}

function writeEncryptedToken(path: string, apiToken: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(path, safeStorage.encryptString(apiToken), { mode: 0o600 })
    return
  }
  console.warn('[productive] safeStorage encryption unavailable — storing token in plaintext')
  writeFileSync(path, apiToken, { encoding: 'utf-8', mode: 0o600 })
}

function readToken(): string | null {
  if (cachedToken !== null) {
    return cachedToken
  }
  const path = getTokenPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = readFileSync(path)
    const token = readStoredCredentialToken('Productive', raw)
    if (token) {
      cachedToken = token
    }
    credentialError = null
    return token
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialError = error.message
      throw error
    }
    return null
  }
}

function deleteToken(): void {
  cachedToken = null
  credentialError = null
  try {
    unlinkSync(getTokenPath())
  } catch {
    // Token may not exist — safe to ignore.
  }
}

export function clearToken(): void {
  cachedToken = null
  credentialError = null
}

export function getClient(): ProductiveClient | null {
  const file = getCredentialFile()
  if (!file) {
    return null
  }
  let token: string | null
  try {
    token = readToken()
  } catch {
    // Why: a decrypt failure already recorded credentialError for getStatus to
    // surface; treat the connection as unavailable rather than throwing here.
    return null
  }
  if (!token || !file.viewer) {
    return null
  }
  return {
    token,
    organizationId: file.organizationId,
    viewerId: file.viewer.id
  }
}

function describeErrorCause(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return undefined
  }
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`
  }
  return cause === undefined ? undefined : String(cause)
}

async function productiveFetch(url: string, init: RequestInit): Promise<Response> {
  return withSpan(
    'productive.request',
    async (span) => {
      span.setAttribute('productive.path', new URL(url).pathname)
      await ensureElectronProxyFromEnvironment({
        proxySession: session.defaultSession,
        probeUrl: url
      }).catch((error) => {
        span.addEvent('productive.proxySetupFailed', {
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      })
      try {
        // Why: Electron's network stack follows Chromium proxy/session state,
        // avoiding undici's stale keep-alive sockets after VPN path changes.
        return await net.fetch(url, init)
      } catch (error) {
        span.setAttribute(
          'productive.transportErrorName',
          error instanceof Error ? error.name : typeof error
        )
        span.setAttribute(
          'productive.transportErrorMessage',
          error instanceof Error ? error.message : String(error)
        )
        const cause = describeErrorCause(error)
        if (cause) {
          span.setAttribute('productive.transportErrorCause', cause)
        }
        throw error
      }
    },
    { kind: 'client' }
  )
}

async function readProductiveError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      errors?: { detail?: string; title?: string }[]
    }
    const messages = (Array.isArray(data.errors) ? data.errors : [])
      .map((error) => error.detail ?? error.title)
      .filter((message): message is string => Boolean(message))
    if (messages.length > 0) {
      return messages.join('; ')
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Productive request failed (${response.status})`
}

function authHeaders(token: string, organizationId: string, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/vnd.api+json')
  headers.set('Content-Type', 'application/vnd.api+json')
  headers.set('User-Agent', PRODUCTIVE_API_USER_AGENT)
  headers.set('X-Auth-Token', token)
  headers.set('X-Organization-Id', organizationId)
  return headers
}

export async function productiveRequest<T>(
  client: ProductiveClient,
  path: string,
  init?: { method?: string; body?: string }
): Promise<T | null> {
  const response = await productiveFetch(`${PRODUCTIVE_API_BASE}${path}`, {
    method: init?.method,
    body: init?.body,
    headers: authHeaders(client.token, client.organizationId)
  })
  if (!response.ok) {
    throw new ProductiveApiError(await readProductiveError(response), response.status)
  }
  if (response.status === 204) {
    return null
  }
  return (await response.json()) as T
}

async function requestWithCredentials(
  token: string,
  organizationId: string,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await productiveFetch(`${PRODUCTIVE_API_BASE}${path}`, {
    ...init,
    headers: authHeaders(token, organizationId, init)
  })
  if (!response.ok) {
    throw new ProductiveApiError(await readProductiveError(response), response.status)
  }
  if (response.status === 204) {
    return null
  }
  return response.json()
}

function personToViewer(data: Record<string, unknown>): ProductiveViewer | null {
  const id = typeof data.id === 'string' ? data.id : ''
  if (!id) {
    return null
  }
  const attributes = (data.attributes ?? {}) as Record<string, unknown>
  const firstName = typeof attributes.first_name === 'string' ? attributes.first_name : ''
  const lastName = typeof attributes.last_name === 'string' ? attributes.last_name : ''
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  return {
    id,
    name: name || (typeof attributes.email === 'string' ? attributes.email : id),
    email: typeof attributes.email === 'string' ? attributes.email : null,
    ...(typeof attributes.avatar_url === 'string' ? { avatarUrl: attributes.avatar_url } : {})
  }
}

async function fetchViewer(
  token: string,
  organizationId: string,
  personId?: string
): Promise<ProductiveViewer> {
  // Why: Productive has no current-user ("/me") endpoint — its own tooling relies
  // on a configured person id. When the user supplies their person id we resolve
  // the real identity (which also drives the "assigned to me" task filters via
  // client.viewerId); a bad id returns a non-2xx here and fails the connection.
  const trimmedPersonId = personId?.trim()
  if (trimmedPersonId) {
    const response = (await requestWithCredentials(
      token,
      organizationId,
      `/people/${encodeURIComponent(trimmedPersonId)}`
    )) as { data?: Record<string, unknown> } | null
    const viewer = personToViewer((response?.data ?? {}) as Record<string, unknown>)
    if (!viewer) {
      throw new ProductiveApiError('Could not resolve the Productive person for that id.', null)
    }
    return viewer
  }

  // No person id: validate the credential PAIR against a collection every valid
  // token can read (a wrong token/organization id returns a non-2xx, surfacing as
  // a connection error), then best-effort enrich identity with the org name.
  await requestWithCredentials(token, organizationId, '/people?page[size]=1')
  let name = 'Productive'
  try {
    const org = (await requestWithCredentials(
      token,
      organizationId,
      `/organizations/${encodeURIComponent(organizationId)}`
    )) as { data?: { attributes?: Record<string, unknown> } } | null
    const orgName = org?.data?.attributes?.name
    if (typeof orgName === 'string' && orgName.trim()) {
      name = orgName.trim()
    }
  } catch {
    // Org-name lookup is best-effort; fall back to a generic label.
  }
  return { id: organizationId, name, email: null }
}

export function getStatus(): ProductiveConnectionStatus {
  const file = getCredentialFile()
  if (!file) {
    return { connected: false, viewer: null }
  }
  let token: string | null = null
  try {
    token = readToken()
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      return {
        connected: false,
        viewer: file.viewer,
        credentialError: error.message
      }
    }
  }
  return {
    connected: Boolean(token) && Boolean(file.viewer),
    viewer: file.viewer,
    ...(credentialError ? { credentialError } : {})
  }
}

export async function connect(args: {
  apiToken: string
  organizationId: string
  personId?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiToken = args.apiToken.trim()
  const organizationId = args.organizationId.trim()
  if (!apiToken || !organizationId) {
    return { ok: false, error: 'API token and organization id are required.' }
  }

  await acquire()
  try {
    const viewer = await fetchViewer(apiToken, organizationId, args.personId)
    ensureOrcaDir()
    writeEncryptedToken(getTokenPath(), apiToken)
    cachedToken = apiToken
    credentialError = null
    writeCredentialFile({
      version: 1,
      organizationId,
      viewer,
      hasToken: true
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Connection failed.' }
  } finally {
    release()
  }
}

export function disconnect(): { ok: true } {
  deleteToken()
  clearCredentialFile()
  return { ok: true }
}

export async function testConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = getCredentialFile()
  if (!file) {
    return { ok: false, error: 'Not connected to Productive.' }
  }
  let token: string | null
  try {
    token = readToken()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Connection failed.' }
  }
  if (!token) {
    return { ok: false, error: 'Not connected to Productive.' }
  }
  await acquire()
  try {
    await fetchViewer(token, file.organizationId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Connection failed.' }
  } finally {
    release()
  }
}

export function isAuthError(error: unknown): boolean {
  // Why: Productive returns 403 for permission gaps even when the token is
  // valid, so only 401 means the saved credential itself is invalid.
  return error instanceof ProductiveApiError && error.status === 401
}
