'use strict';

var async             = require('async'),
	isEmpty           = require('lodash.isempty'),
	platform          = require('./platform'),
	clients           = {},
	authorizedDevices = {},
	server, port;

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
platform.once('ready', function (options, registeredDevices) {
	let dgram  = require('dgram'),
		keyBy  = require('lodash.keyby'),
		config = require('./config.json');

	if (!isEmpty(registeredDevices))
		authorizedDevices = keyBy(registeredDevices, '_id');

	server = dgram.createSocket();
	port = options.port;

	let dataTopic = options.data_topic || config.data_topic.default;
	let messageTopic = options.message_topic || config.message_topic.default;
	let groupMessageTopic = options.groupmessage_topic || config.groupmessage_topic.default;

	server.on('listening', () => {
		platform.log(`UDP Gateway initialized on port ${options.port}`);
		platform.notifyReady();
	});

	server.on('message', (data, rinfo) => {
		data = data.toString().replace(/\n$/g, '')

		async.waterfall([
			async.constant(data || '{}'),
			async.asyncify(JSON.parse)
		], (error, obj) => {
			if (error || isEmpty(obj.device) || isEmpty(obj.topic)) return platform.handleException(new Error('Invalid data sent. Data must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.'));

			if (isEmpty(authorizedDevices[obj.device])) {
				return platform.log(JSON.stringify({
					title: 'UDP Gateway - Access Denied. Unauthorized Device',
					device: obj.device
				}));
			}

			if (obj.topic === dataTopic) {
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
			}
			else if (obj.topic === messageTopic) {
				if (isEmpty(obj.target) || isEmpty(obj.message)) return platform.handleException(new Error('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.'));

				platform.sendMessageToDevice(obj.target, obj.message);

				platform.log(JSON.stringify({
					title: 'UDP Gateway Message Sent.',
					source: obj.device,
					target: obj.target,
					message: obj.message
				}));
			}
			else if (obj.topic === groupMessageTopic) {
				if (isEmpty(obj.target) || isEmpty(obj.message)) return platform.handleException(new Error('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group id or name. "message" is the payload.'));

				platform.sendMessageToGroup(obj.target, obj.message);

				platform.log(JSON.stringify({
					title: 'UDP Gateway Group Message Sent.',
					source: obj.device,
					target: obj.target,
					message: obj.message
				}));
			}
			else
				platform.handleException(new Error(`Invalid topic specified. Topic: ${obj.topic}`));
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