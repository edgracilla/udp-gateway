'use strict';

var domain            = require('domain'),
	isEmpty           = require('lodash.isempty'),
	platform          = require('./platform'),
	clients           = {},
	authorizedDevices = {},
	server, port;

platform.on('message', function (message) {
	if (clients[message.device]) {
		let msg = message.message || new Buffer([0x00]);

		if (!Buffer.isBuffer(msg))
			msg = new Buffer(`${msg}\n`);

		let client = clients[message.device];

		server.send(msg, 0, msg.length, client.port, client.address, () => {
			platform.sendMessageResponse(message.messageId, 'Message Sent');
			platform.log(JSON.stringify({
				title: 'Message Sent',
				device: message.device,
				messageId: message.messageId,
				message: message.message
			}));
		});
	}
});

/*
 * When a new device is added, add it to the list of authorized devices.
 */
platform.on('adddevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		authorizedDevices[device._id] = device;
		platform.log(`UDP Gateway - Successfully added ${device._id} to the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not added. ${device}`));
});

/*
 * When a device is removed or deleted, remove it from the list of authorized devices.
 */
platform.on('removedevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		delete authorizedDevices[device._id];
		platform.log(`UDP Gateway - Successfully removed ${device._id} from the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not removed. ${device}`));
});

/*
 * Event to listen to in order to gracefully release all resources bound to this service.
 */
/*
 * Event to listen to in order to gracefully release all resources bound to this service.
 */
platform.on('close', function () {
	let d = domain.create();

	d.once('error', (error) => {
		console.error(`Error closing UDP Gateway on port ${port}`, error);
		platform.handleException(error);
		platform.notifyClose();
	});

	d.run(() => {
		server.close(() => {
			console.log(`UDP Gateway closed on port ${port}`);
			platform.notifyClose();
		});
	});
});

/*
 * Listen for the ready event.
 */
platform.once('ready', function (options, registeredDevices) {
	let dgram      = require('dgram'),
		keyBy      = require('lodash.keyby'),
		config     = require('./config.json'),
		socketType = options.socket_type || config.socket_type.default,
		msg;

	if (!isEmpty(registeredDevices))
		authorizedDevices = keyBy(registeredDevices, '_id');

	server = dgram.createSocket(socketType);
	port = options.port;

	let dataTopic = options.data_topic || config.data_topic.default;
	let messageTopic = options.message_topic || config.message_topic.default;
	let groupMessageTopic = options.groupmessage_topic || config.groupmessage_topic.default;

	server.on('listening', () => {
		platform.log(`UDP Gateway initialized on port ${options.port}`);
		platform.notifyReady();
	});

	server.on('message', (data, rinfo) => {
		let d = require('domain').create();

		d.once('error', () => {
			msg = new Buffer('Invalid data sent. Data must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.\n');

			server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			d.exit();
		});

		d.run(() => {
			data = data.toString().replace(/\n$/g, '');

			let obj = JSON.parse(data);

			if (isEmpty(obj.device)) {
				msg = new Buffer('Invalid data sent. Data must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.\n');

				platform.handleException(new Error('Invalid data sent. Data must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.'));

				return d.exit();
			}

			if (isEmpty(authorizedDevices[obj.device])) {
				platform.log(JSON.stringify({
					title: 'UDP Gateway - Access Denied. Unauthorized Device',
					device: obj.device
				}));

				msg = new Buffer('Access Denied. Unauthorized Device.\n');

				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

				return d.exit();
			}

			if (isEmpty(obj.topic)) {
				msg = new Buffer('Invalid data sent. No "topic" specified in JSON.\n');

				platform.handleException(new Error('Invalid data sent. No "topic" specified in JSON.'));
				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

				return d.exit();
			}
			else if (obj.topic === dataTopic) {
				platform.processData(obj.device, data);

				platform.log(JSON.stringify({
					title: 'UDP Gateway Data Received.',
					device: obj.device,
					data: data
				}));

				if (isEmpty(clients[obj.device])) {
					clients[obj.device] = {
						address: rinfo.address,
						port: rinfo.port
					};
				}

				msg = new Buffer('Data Processed\n');
				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			}
			else if (obj.topic === messageTopic) {
				if (isEmpty(obj.target) || isEmpty(obj.message)) {
					msg = new Buffer('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.\n');

					platform.handleException(new Error('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.'));
					server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

					return d.exit();
				}

				platform.sendMessageToDevice(obj.target, obj.message);

				platform.log(JSON.stringify({
					title: 'UDP Gateway Message Sent.',
					source: obj.device,
					target: obj.target,
					message: obj.message
				}));

				msg = new Buffer('Message Processed\n');
				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			}
			else if (obj.topic === groupMessageTopic) {
				if (isEmpty(obj.target) || isEmpty(obj.message)) {
					msg = new Buffer('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group name. "message" is the payload.\n');
					platform.handleException(new Error('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group name. "message" is the payload.'));

					server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

					return d.exit();
				}

				platform.sendMessageToGroup(obj.target, obj.message);

				platform.log(JSON.stringify({
					title: 'UDP Gateway Group Message Sent.',
					source: obj.device,
					target: obj.target,
					message: obj.message
				}));

				msg = new Buffer('Group Message Processed\n');

				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			}
			else {
				platform.handleException(new Error(`Invalid topic specified. Topic: ${obj.topic}`));
				msg = new Buffer(`Invalid topic specified. Topic: ${obj.topic}\n`);

				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			}

			d.exit();
		});
	});

	server.on('error', (error) => {
		console.error('UDP Gateway Error', error);
		platform.handleException(error);
	});

	server.bind({
		port: port,
		exclusive: false
	});
});