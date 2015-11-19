'use strict';

var domain            = require('domain'),
	isEmpty           = require('lodash.isempty'),
	platform          = require('./platform'),
	clients           = {},
	authorizedDevices = {},
	server, port;

/*
 * Listen for the message event. Send these messages/commands to devices from this server.
 */
platform.on('message', function (message) {
	if (clients[message.device]) {
		var msg = message.message || new Buffer([0x00]);

		if (!Buffer.isBuffer(msg))
			msg = new Buffer(msg + '\n');

		var client = clients[message.device];

		server.send(msg, 0, msg.length, client.port, client.address, function () {
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
		platform.log('Successfully added ' + device._id + ' to the pool of authorized devices.');
	}
	else
		platform.handleException(new Error('Device data invalid. Device not added. ' + device));
});

/*
 * When a device is removed or deleted, remove it from the list of authorized devices.
 */
platform.on('removedevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		delete authorizedDevices[device._id];
		platform.log('Successfully removed ' + device._id + ' from the pool of authorized devices.');
	}
	else
		platform.handleException(new Error('Device data invalid. Device not removed. ' + device));
});

/*
 * Event to listen to in order to gracefully release all resources bound to this service.
 */
/*
 * Event to listen to in order to gracefully release all resources bound to this service.
 */
platform.on('close', function () {
	var closeDomain = domain.create();

	closeDomain.once('error', function (error) {
		console.error('Error closing UDP Gateway on port ' + port, error);
		platform.handleException(error);
		platform.notifyClose();
	});

	closeDomain.run(function () {
		server.close(function () {
			console.log('UDP Gateway closed on port ' + port);
			platform.notifyClose();
		});
	});
});

/*
 * Listen for the ready event.
 */
platform.once('ready', function (options, registeredDevices) {
	var dgram        = require('dgram'),
		clone        = require('lodash.clone'),
		config       = require('./config.json');

	if (!isEmpty(registeredDevices)) {
		var indexBy    = require('lodash.indexby'),
			tmpDevices = clone(registeredDevices, true);

		authorizedDevices = indexBy(tmpDevices, '_id');
	}

	var msg;
	var socketType = options.socket_type || config.socket_type.default;

	server = dgram.createSocket(socketType);
	port = options.port;

	server.on('listening', function () {
		platform.log('UDP Gateway initialized on port ' + options.port);
		platform.notifyReady();
	});

	server.on('message', function (data, rinfo) {
		var socketDomain = require('domain').create();

		socketDomain.once('error', function () {
			msg = new Buffer('Invalid data sent. This UDP Gateway only accepts JSON data.\n');

			server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			socketDomain.exit();
		});

		socketDomain.run(function () {
			data = data.toString().replace(/\n$/, '');

			var obj = JSON.parse(data);

			if (isEmpty(obj.device)) return socketDomain.exit();

			if (isEmpty(authorizedDevices[obj.device])) {
				platform.log(JSON.stringify({
					title: 'Unauthorized Device',
					device: obj.device
				}));

				socketDomain.removeAllListeners('error');

				msg = new Buffer('Access Denied. Unauthorized Device.\n');

				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);

				return socketDomain.exit();
			}

			if (obj.type === 'data') {
				platform.processData(obj.device, data);
				platform.log(JSON.stringify({
					title: 'Data Received.',
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
			else if (obj.type === 'message') {
				platform.sendMessageToDevice(obj.target, obj.message);

				platform.log(JSON.stringify({
					title: 'Message Sent.',
					source: obj.device,
					target: obj.target,
					message: obj.message
				}));
			}
			else if (obj.type === 'groupmessage') {
				platform.sendMessageToGroup(obj.target, obj.message);

				platform.log(JSON.stringify({
					title: 'Group Message Sent.',
					source: obj.device,
					target: obj.target,
					message: obj.message
				}));
			}
			else {
				msg = new Buffer('Invalid data. One or more fields missing. [device, type] are required for data. [device, type, target, message] are required for messages.\n');

				server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
			}

			socketDomain.exit();
		});
	});

	server.on('error', function (error) {
		console.error('UDP Gateway Error', error);
		platform.handleException(error);
	});

	server.bind({
		port: port,
		exclusive: false
	});
});