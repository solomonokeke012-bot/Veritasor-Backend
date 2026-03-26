/**
 * Shopify OAuth callback: validate state, exchange code for access token, store token.
 * Access tokens are never logged.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import * as store from './store.js'

// Module-level constants kept for backward compat; handleCallback reads fresh values inside the function
const clientId = process.env.SHOPIFY_CLIENT_ID ?? ''
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET ?? ''

const SHOP_HOST_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/

/**
 * Compute the Shopify HMAC-SHA256 signature for a set of callback query parameters.
 * The `hmac` key is excluded from the digest input per Shopify's specification.
 *
 * @param secret - SHOPIFY_CLIENT_SECRET used as the HMAC key
 * @param params - All callback query parameters (including or excluding `hmac`)
 * @returns Lowercase hex-encoded HMAC-SHA256 digest
 */
export function computeShopifyHmac(secret: string, params: Record<string, string>): string {
  const queryString = Object.keys(params)
    .filter(key => key !== 'hmac')
    .sort()
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&')

  return createHmac('sha256', secret).update(queryString).digest('hex')
}

export interface CallbackParams {
  code: string
  shop: string
  state: string
  hmac?: string
  [key: string]: string | undefined
}

export interface CallbackResult {
  success: boolean
  shop?: string
  error?: string
}

/**
 * Handle OAuth callback: consume state, exchange code for token, persist via integration store.
 */
export async function handleCallback(params: Record<string, string>): Promise<CallbackResult> {
  // Read fresh values so tests can override process.env before calling this function
  const currentClientId = process.env.SHOPIFY_CLIENT_ID ?? ''
  const currentClientSecret = process.env.SHOPIFY_CLIENT_SECRET ?? ''

  if (!currentClientId || !currentClientSecret) {
    return { success: false, error: 'Shopify app not configured' }
  }

  const { code, shop, state, hmac } = params

  // Parameter completeness guard — check code, shop, state first
  if (!code || !shop || !state) {
    return { success: false, error: 'Missing required callback parameters' }
  }

  // HMAC presence guard — absent or empty string both count as missing
  if (!hmac) {
    return { success: false, error: 'Missing HMAC signature' }
  }

  // HMAC validation using constant-time comparison
  const computed = computeShopifyHmac(currentClientSecret, params)
  const computedBuf = Buffer.from(computed)
  const providedBuf = Buffer.from(hmac)
  if (
    computedBuf.length !== providedBuf.length ||
    !timingSafeEqual(computedBuf, providedBuf)
  ) {
    return { success: false, error: 'Invalid HMAC signature' }
  }

  const shopHost = shop.trim().toLowerCase()
  if (!SHOP_HOST_REGEX.test(shopHost)) {
    return { success: false, error: 'Invalid shop hostname' }
  }

  const storedShop = store.consumeOAuthState(state)
  if (!storedShop || storedShop !== shopHost) {
    return { success: false, error: 'Invalid or expired state' }
  }

  const tokenUrl = `https://${shopHost}/admin/oauth/access_token`
  const body = new URLSearchParams({
    client_id: currentClientId,
    client_secret: currentClientSecret,
    code,
  })

  let res: Response
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    })
  } catch (err) {
    return { success: false, error: 'Token exchange request failed' }
  }

  if (!res.ok) {
    return { success: false, error: 'Token exchange failed' }
  }

  const data = (await res.json()) as { access_token?: string }
  const accessToken = data?.access_token
  if (!accessToken || typeof accessToken !== 'string') {
    return { success: false, error: 'No access token in response' }
  }

  store.saveToken(shopHost, accessToken)
  return { success: true, shop: shopHost }
}
