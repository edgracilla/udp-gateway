'use strict';

var async    = require('async'),
	isEmpty  = require('lodash.isempty'),
	platform = require('./platform'),
	clients  = {},
	server, port;

platform.on('message', function (message) {
	if (!isEmpty(clients[message.device])) {
		let msg = message.message || new Buffer([0x00]);

		if (!Buffer.isBuffer(msg))
			msg = new Buffer(`${msg}\n`);

		server.send(msg, 0, msg.length, clients[message.device].port, clients[message.device].address, () => {
			platform.sendMessageResponse(message.messageId, 'Message Sent');

			platform.log(JSON.stringify({
				title: 'UDP Gateway - Message Sent',
				device: message.device,
				messageId: message.messageId,
				message: message.message
			}));
		});
	}
});

/*
 * Event to listen to in order to gracefully release all resources bound to this service.
 */
platform.on('close', function () {
	let d = require('domain').create();

	d.once('error', function (error) {
		console.error(`Error closing UDP Gateway on port ${port}`, error);
		platform.handleException(error);
		platform.notifyClose();
	});

	d.run(function () {
		server.close(() => {
			console.log(`UDP Gateway closed on port ${port}`);
			platform.notifyClose();
		});
	});
});

/*
 * Listen for the ready event.
 */
platform.once('ready', function (options) {
	let dgram  = require('dgram'),
		config = require('./config.json');

	server = dgram.createSocket('udp4');
	port = options.port;

	let dataTopic = options.data_topic || config.data_topic.default;
	let messageTopic = options.message_topic || config.message_topic.default;
	let groupMessageTopic = options.groupmessage_topic || config.groupmessage_topic.default;

	server.on('listening', () => {
		platform.log(`UDP Gateway initialized on port ${options.port}`);
		platform.notifyReady();
	});

	server.on('message', (data, rinfo) => {
		data = data.toString().replace(/\n$/g, '');

		async.waterfall([
			async.constant(data || '{}'),
			async.asyncify(JSON.parse)
		], (error, obj) => {
			if (error || isEmpty(obj.device) || isEmpty(obj.topic)) return platform.handleException(new Error('Invalid data sent. Data must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.'));

			if (isEmpty(clients[obj.device]))
				clients[obj.device] = {address: rinfo.address, port: rinfo.port};

			platform.notifyConnection(obj.device);

			platform.requestDeviceInfo(obj.device, (error, requestId) => {
				platform.once(requestId, (deviceInfo) => {
					if (isEmpty(deviceInfo)) {
						let msg = new Buffer(`Device not registered. Device ID: ${obj.device}\n`);

						server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

						return platform.log(JSON.stringify({
							title: 'UDP Gateway - Access Denied. Unauthorized Device',
							device: obj.device
						}));
					}

					if (obj.topic === dataTopic) {
						platform.processData(obj.device, data);

						let msg = new Buffer(`Data Received. Device ID: ${obj.device}. Data: ${data}\n`);

						server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

						platform.log(JSON.stringify({
							title: 'UDP Gateway Data Received.',
							device: obj.device,
							data: data
						}));
					}
					else if (obj.topic === messageTopic) {
						if (isEmpty(obj.target) || isEmpty(obj.message)) {
							let msg = new Buffer('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.\n');

							server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
							return platform.handleException(new Error('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.'));
						}

						platform.sendMessageToDevice(obj.target, obj.message);

						let msg = new Buffer(`Message Received. Device ID: ${obj.device}. Message: ${data}\n`);

						server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

						platform.log(JSON.stringify({
							title: 'UDP Gateway Message Sent.',
							source: obj.device,
							target: obj.target,
							message: obj.message
						}));
					}
					else if (obj.topic === groupMessageTopic) {
						if (isEmpty(obj.target) || isEmpty(obj.message)) {
							let msg = new Buffer('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group id or name. "message" is the payload.\n');

							server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
							return platform.handleException(new Error('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group id or name. "message" is the payload.'));
						}

						platform.sendMessageToGroup(obj.target, obj.message);

						let msg = new Buffer(`Message Received. Device ID: ${obj.device}. Message: ${data}\n`);

						server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

						platform.log(JSON.stringify({
							title: 'UDP Gateway Group Message Sent.',
							source: obj.device,
							target: obj.target,
							message: obj.message
						}));
					}
					else {
						let msg = new Buffer(`Invalid topic specified. Topic: ${obj.topic}`);

						platform.handleException(new Error(`Invalid topic specified. Topic: ${obj.topic}`));
						server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
					}
				});
			});
		});
	});

	server.on('error', (error) => {
		console.error('UDP Gateway Error', error);
		platform.handleException(error);
		server.close();

		setTimeout(() => {
			process.exit();
		}, 5000);
	});

	server.bind(port);
});