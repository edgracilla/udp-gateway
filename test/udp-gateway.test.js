/* global describe, it, after, before */
'use strict'

const dgram = require('dgram')
const async = require('async')
const amqp = require('amqplib')
const should = require('should')
const isEmpty = require('lodash.isempty')

const Broker = require('../node_modules/reekoh/lib/broker.lib')

const PORT = 8182
const PLUGIN_ID = 'demo.gateway'
const BROKER = 'amqp://guest:guest@127.0.0.1/'
const OUTPUT_PIPES = 'demo.outpipe1,demo.outpipe2'
const COMMAND_RELAYS = 'demo.relay1,demo.relay2'

let _app = null
let _conn = null
let _broker = null
let _channel = null

let client1 = null
let client2 = null

let conf = {
  port: PORT,
  dataTopic: 'data',
  commandTopic: 'command'
}

describe('UDP Gateway', () => {
  before('init', () => {
    process.env.BROKER = BROKER
    process.env.PLUGIN_ID = PLUGIN_ID
    process.env.OUTPUT_PIPES = OUTPUT_PIPES
    process.env.COMMAND_RELAYS = COMMAND_RELAYS
    process.env.CONFIG = JSON.stringify(conf)

    _broker = new Broker()
    client1 = dgram.createSocket('udp4')
    client2 = dgram.createSocket('udp4')

    amqp.connect(BROKER).then((conn) => {
      _conn = conn
      return conn.createChannel()
    }).then((channel) => {
      _channel = channel
    }).catch((err) => {
      console.log(err)
    })
  })

  after('terminate', function () {
    _conn.close()
    client1.close()
    client2.close()
  })

  describe('#start', function () {
    it('should start the app', function (done) {
      this.timeout(10000)
      _app = require('../app')
      _app.once('init', done)
    })
  })

  describe('#test RPC preparation', () => {
    it('should connect to broker', (done) => {
      _broker.connect(BROKER).then(() => {
        return done() || null
      }).catch((err) => {
        done(err)
      })
    })

    it('should spawn temporary RPC server', (done) => {
      // if request arrives this proc will be called
      let sampleServerProcedure = (msg) => {
        // console.log(msg.content.toString('utf8'))
        return new Promise((resolve, reject) => {
          async.waterfall([
            async.constant(msg.content.toString('utf8')),
            async.asyncify(JSON.parse)
          ], (err, parsed) => {
            if (err) return reject(err)
            parsed.foo = 'bar'
            resolve(JSON.stringify(parsed))
          })
        })
      }

      _broker.createRPC('server', 'deviceinfo').then((queue) => {
        return queue.serverConsume(sampleServerProcedure)
      }).then(() => {
        // Awaiting RPC requests
        done()
      }).catch((err) => {
        done(err)
      })
    })
  })

  describe('#data', function () {
    it('should process the data', function (done) {
      this.timeout(10000)

      let message = new Buffer(JSON.stringify({
        topic: 'data',
        device: '567827489028375',
        deviceGroup: '',
        command: 'ACTIVATE'
      }))

      client1.send(message, 0, message.length, PORT, 'localhost')
      _app.once('data.ok', done)
    })
  })

  describe('#command', function () {
    it('should create commandRelay listener', function (done) {
      this.timeout(10000)

      let cmdRelays = `${COMMAND_RELAYS || ''}`.split(',').filter(Boolean)

      async.each(cmdRelays, (cmdRelay, cb) => {
        _channel.consume(cmdRelay, (msg) => {
          if (!isEmpty(msg)) {
            async.waterfall([
              async.constant(msg.content.toString('utf8') || '{}'),
              async.asyncify(JSON.parse)
            ], (err, obj) => {
              if (err) return console.log('parse json err. supplied invalid data')

              let devices = []

              if (Array.isArray(obj.devices)) {
                devices = obj.devices
              } else {
                devices.push(obj.devices)
              }

              // if (obj.deviceGroup) {
                // TODO: get devices from platform agent then push to devices[]
              // }

              async.each(devices, (device, cb) => {
                _channel.publish('amq.topic', `${cmdRelay}.topic`, new Buffer(JSON.stringify({
                  sequenceId: obj.sequenceId,
                  commandId: new Date().getTime().toString(), // uniq
                  command: obj.command,
                  device: device
                })))
                cb()
              }, (err) => {
                should.ifError(err)
              })
            })
          }
          _channel.ack(msg)
        }).then(() => {
          return cb()
        }).catch((err) => {
          should.ifError(err)
        })
      }, done)
    })

    it('should be able to send command to device', function (done) {
      this.timeout(10000)

      let message = new Buffer(JSON.stringify({
        topic: 'command',
        device: '567827489028375',
        target: '567827489028376',
        deviceGroup: '',
        command: 'ACTIVATE'
      }))

      client1.send(message, 0, message.length, PORT, 'localhost')

      _app.once('command.ok', () => {
        done()
      })
    })

    it('should be able to recieve command response', function (done) {
      let message = new Buffer(JSON.stringify({
        topic: 'command',
        device: '567827489028376',
        target: '567827489028375',
        deviceGroup: '',
        command: 'ACTIVATE'
      }))

      client2.send(message, 0, message.length, PORT, 'localhost')
      _app.once('response.ok', done)
    })
  })

  /*

   NOTE: not testable yet since we cant pull devices from group yet

   it('should be able to send command to group of device', function (done) {
   this.timeout(10000)

   let message = new Buffer(JSON.stringify({
   topic: 'data',
   deviceGroup: 'group123',
   command: 'ACTIVATE'
   }))

   client1.send(message, 0, message.length, PORT, 'localhost')
   _app.once('command.ok', done)
   })

   */
})
