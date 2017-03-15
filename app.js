'use strict'

const reekoh = require('reekoh')
const plugin = new reekoh.plugins.Gateway()

const async = require('async')
const isEmpty = require('lodash.isempty')

let clients = {}
let socket = null

plugin.once('ready', () => {
  plugin.emit('init')
  let dgram = require('dgram')
  let options = plugin.config

  socket = dgram.createSocket('udp4')

  let dataTopic = options.dataTopic
  let commandTopic = options.commandTopic

  let handleErr = (err) => {
    console.error(err)
    plugin.logException(err)
  }

  socket.once('error', (error) => {
    console.error('UDP Gateway Error', error)
    plugin.logException(error)

    setTimeout(() => {
      socket.close(() => {
        socket.removeAllListeners()
        process.exit()
      })
    }, 5000)
  })

  socket.once('listening', () => {
    plugin.log(`UDP Gateway initialized on port ${options.port}`)
    plugin.emit('init')
  })

  socket.once('close', () => {
    plugin.log(`UDP Gateway closed on port ${options.port}`)
  })

  socket.on('message', (data, rinfo) => {
    data = data.toString().replace(/\n$/g, '')

    async.waterfall([
      async.constant(data || '{}'),
      async.asyncify(JSON.parse)
    ], (error, obj) => {
      if (error || isEmpty(obj.device) || isEmpty(obj.topic)) {
        return plugin.logException(new Error('Invalid data sent. Data must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.'))
      }

      if (isEmpty(clients[obj.device])) {
        clients[obj.device] = {
          port: rinfo.port,
          address: rinfo.address
        }
      }

      plugin.notifyConnection(obj.device)

      plugin.requestDeviceInfo(obj.device).then((deviceInfo) => {
        if (isEmpty(deviceInfo)) {
          let msg = new Buffer(`Device not registered. Device ID: ${obj.device}\n`)

          socket.send(msg, 0, msg.length, rinfo.port, rinfo.address)

          return plugin.log(JSON.stringify({
            title: 'UDP Gateway - Access Denied. Unauthorized Device',
            device: obj.device
          }))
        }

        if (obj.topic === dataTopic) {
          return plugin.pipe(obj).then(() => {
            let msg = new Buffer(`Data Received. Device ID: ${obj.device}. Data: ${data}\n`)

            socket.send(msg, 0, msg.length, rinfo.port, rinfo.address)
            plugin.emit('data.ok')

            return plugin.log(JSON.stringify({
              title: 'UDP Gateway Data Received.',
              device: obj.device,
              data: data
            }))
          }).catch(handleErr)
        } else if (obj.topic === commandTopic) {
          if (isEmpty(obj.command) || (isEmpty(obj.device) && isEmpty(obj.deviceGroup))) {
            let msg = 'Invalid message or command. Message must be a valid JSON String with "device" or "deviceGroup" and "command" fields. "device" is the a registered Device ID. "command" is the payload.'

            return plugin
              .logException(new Error(msg))
              .then(() => socket.send(msg, 0, msg.length, rinfo.port, rinfo.address))
          }

          return plugin.relayCommand(obj.command, obj.target, obj.deviceGroup, obj.device).then(() => {
            let msg = new Buffer(`Message Received. Device ID: ${obj.device}. Message: ${data}\n`)

            socket.send(msg, 0, msg.length, rinfo.port, rinfo.address)
            plugin.emit('command.ok')

            return plugin.log(JSON.stringify({
              title: 'UDP Gateway Message Sent.',
              device: obj.device,
              command: obj.command
            }))
          }).catch(handleErr)
        } else {
          let msg = new Buffer(`Invalid topic specified. Topic: ${obj.topic}`)
          plugin.logException(new Error(`Invalid topic specified. Topic: ${obj.topic}`))
          socket.send(msg, 0, msg.length, rinfo.port, rinfo.address)
        }
      }).catch(handleErr)
    })
  })
  socket.bind(options.port)
})

plugin.on('command', (msg) => {
  if (!isEmpty(clients[msg.device])) {
    let pkt = msg.message || new Buffer([0x00])

    if (!Buffer.isBuffer(pkt)) pkt = new Buffer(`${pkt}\n`)

    socket.send(pkt, 0, pkt.length, clients[msg.device].port, clients[msg.device].address, () => {
      plugin.sendCommandResponse(msg.commandId, 'Message Sent').then(() => {
        plugin.emit('response.ok')
        plugin.log(JSON.stringify({
          title: 'UDP Gateway - Message Sent',
          device: msg.device,
          commandId: msg.commandId,
          command: msg.command
        }))
      })
    })
  }
})

module.exports = plugin
