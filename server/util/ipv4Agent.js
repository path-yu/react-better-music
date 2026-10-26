const dns = require('dns')
const http = require('http')
const https = require('https')

/**
 * Windows' getaddrinfo() can stall for ~11 seconds when the machine has an
 * unreachable IPv6 DNS server: it waits for that server before falling back to
 * IPv4. Node's `family: 4` only affects the connection attempt, not the DNS
 * lookup, so a cold lookup still pays the full timeout.
 *
 * We resolve A records ourselves through IPv4 DNS servers (c-ares, tens of
 * milliseconds) and cache the result. This also skips Happy Eyeballs, which
 * would otherwise try an unreachable IPv6 address first.
 */
const DNS_TTL = 5 * 60 * 1000
const DNS_TIMEOUT = 2000
const DNS_SERVERS = ['223.5.5.5', '119.29.29.29', '114.114.114.114']
const PREWARM_HOSTS = [
  'music.163.com',
  'interface.music.163.com',
  'interface3.music.163.com',
  'm.music.163.com',
]

const cache = new Map()
const pending = new Map()

function resolveWith(server, hostname) {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver()
    resolver.setServers([server])
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolver.cancel()
      reject(new Error(`DNS timeout via ${server}`))
    }, DNS_TIMEOUT)
    resolver.resolve4(hostname, (error, addresses) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error || !addresses || !addresses.length) {
        reject(error || new Error(`No A record for ${hostname}`))
      } else {
        resolve(addresses)
      }
    })
  })
}

function systemLookup(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { family: 4, all: true }, (error, result) => {
      if (error) {
        reject(error)
        return
      }
      const addresses = (result || []).map((item) => item.address)
      if (!addresses.length) reject(new Error(`No IPv4 address for ${hostname}`))
      else resolve(addresses)
    })
  })
}

function resolveHost(hostname) {
  const cached = cache.get(hostname)
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.addresses)

  const inflight = pending.get(hostname)
  if (inflight) return inflight

  const task = (async () => {
    for (const server of DNS_SERVERS) {
      try {
        const addresses = await resolveWith(server, hostname)
        cache.set(hostname, { addresses, expires: Date.now() + DNS_TTL })
        return addresses
      } catch {
        // try the next resolver
      }
    }
    // Last resort: use the OS resolver (slow when IPv6 DNS is unreachable,
    // but it is the only option on networks that block public DNS).
    console.warn(`[dns] public resolvers failed for ${hostname}, using system resolver`)
    const addresses = await systemLookup(hostname)
    cache.set(hostname, { addresses, expires: Date.now() + DNS_TTL })
    return addresses
  })().finally(() => {
    pending.delete(hostname)
  })

  pending.set(hostname, task)
  return task
}

/** Custom lookup used by the HTTP(S) agents' sockets. */
function lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  const wantsAll = Boolean(options && options.all)
  resolveHost(hostname).then(
    (addresses) => {
      if (wantsAll) {
        callback(
          null,
          addresses.map((address) => ({ address, family: 4 })),
        )
      } else {
        callback(null, addresses[0], 4)
      }
    },
    (error) => callback(error),
  )
}

function withIpv4(agent) {
  const createConnection = agent.createConnection.bind(agent)
  agent.createConnection = (options, callback) =>
    createConnection(
      { ...options, family: 4, autoSelectFamily: false, lookup },
      callback,
    )
  return agent
}

function createHttpAgent() {
  return withIpv4(new http.Agent({ keepAlive: true, timeout: 30000 }))
}

function createHttpsAgent() {
  return withIpv4(new https.Agent({ keepAlive: true, timeout: 30000 }))
}

// Warm the common upstream hosts while the app is still starting up.
for (const host of PREWARM_HOSTS) {
  resolveHost(host).catch(() => undefined)
}

module.exports = { createHttpAgent, createHttpsAgent }
