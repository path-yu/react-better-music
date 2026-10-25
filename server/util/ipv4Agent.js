const http = require('http')
const https = require('https')

/**
 * Node's `autoSelectFamily` (Happy Eyeballs) can attempt an unreachable IPv6
 * address first and stall ~10s before falling back to IPv4. `http.Agent`
 * filters its constructor options, so `family`/`autoSelectFamily` must be
 * injected at the socket level.
 */
function withIpv4(agent) {
  const createConnection = agent.createConnection.bind(agent)
  agent.createConnection = (options, callback) =>
    createConnection({ ...options, family: 4, autoSelectFamily: false }, callback)
  return agent
}

function createHttpAgent() {
  return withIpv4(new http.Agent({ keepAlive: true, timeout: 30000 }))
}

function createHttpsAgent() {
  return withIpv4(new https.Agent({ keepAlive: true, timeout: 30000 }))
}

module.exports = { createHttpAgent, createHttpsAgent }
