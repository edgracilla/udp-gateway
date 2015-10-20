'use strict';

var server, serverAddress,
	platform = require('./platform');

/*
 * Listen for the message event. Send these messages/commands to devices to this server.
 */
platform.on('message', function (message) {
	if (server.getClients()[message.client]) {
		server.send(message.client, message.message, function (error) {
			if (error) {
				console.error('Message Sending Error', error);
				platform.sendMessageResponse(message.messageId, error.name);
				platform.handleException(error);
			}
			else {
				platform.sendMessageResponse(message.messageId, 'Message Sent');
				platform.log('Message Sent', message.message);
			}
		});
	}
});

/*
 * Listen for the ready event.
 */
platform.once('ready', function (options) {
	var config        = require('./config.json'),
		isJSON        = require('is-json'),
		UDPServer     = require('./server'),
		StringDecoder = require('string_decoder').StringDecoder,
		decoder       = new StringDecoder('utf8');

	server = new UDPServer(options.socket_type || config.socket_type.default);

	server.on('ready', function () {
		platform.notifyReady();
		console.log('UDP Server now listening on port '.concat(options.port));
	});

	server.on('data', function (client, rawData) {
		var data = decoder.write(rawData);

		if (isJSON(data)) {
			var obj = JSON.parse(data);

			if (obj.type === 'data')
				platform.processData(obj.device, data);
			else if (obj.type === 'message')
				platform.sendMessageToDevice(obj.target, obj.message);
			else if (obj.type === 'groupmessage')
				platform.sendMessageToGroup(obj.target, obj.message);
		}

		platform.log('Raw Data Received', data);
	});

	server.on('error', function (error) {
		platform.handleException(error);
	});

	server.on('close', function () {
		platform.notifyClose();
	});

	server.listen(options.port, '0.0.0.0');
});