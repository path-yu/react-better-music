const fs = require('fs')
const path = require('path')
const request = require('./util/request')
const registerAnonimous = require('./module/register_anonimous')
const { cookieToJson, generateRandomChineseIP } = require('./util/index')
const { getXeapiPublicKey } = require('./util/xeapiKey')
const { loadNeapiKey } = require('./util/neapiKey')
const registerNeapikey = require('./module/register_neapikey')
const tmpPath = require('os').tmpdir()

async function generateConfig() {
  global.cnIp = generateRandomChineseIP()
  try {
    const res = await registerAnonimous({}, request)
    const cookie = res.body.cookie
    if (cookie) {
      const cookieObj = cookieToJson(cookie)
      fs.writeFileSync(
        path.resolve(tmpPath, 'anonymous_token'),
        cookieObj.MUSIC_A,
        'utf-8',
      )
    }
  } catch (error) {
    console.log(error)
  }
  try {
    let currentPublicKey = {}
    try {
      currentPublicKey = JSON.parse(
        fs.readFileSync(path.resolve(tmpPath, 'xeapi_public_key'), 'utf-8'),
      )
    } catch (_) {}
    const publicKey = await getXeapiPublicKey(currentPublicKey, global.deviceId)
    fs.writeFileSync(
      path.resolve(tmpPath, 'xeapi_public_key'),
      JSON.stringify(publicKey),
      'utf-8',
    )
  } catch (error) {
    console.log(error)
  }
  try {
    const current = loadNeapiKey()
    await registerNeapikey(
      {
        version: current ? current.version : 0,
        behavior: current ? 'update' : 'open',
      },
      null,
    )
  } catch (error) {
    console.log(error)
  }
}
module.exports = generateConfig
